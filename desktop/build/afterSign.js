// electron-builder's own mac.identity config only accepts the NAME of a
// real certificate already sitting in the keychain — "-" (codesign's
// actual ad-hoc shorthand) doesn't mean anything to it and just gets
// searched for and not found, so it falls back to "skipped code signing"
// exactly like leaving identity unset at all (see the codesign -dv
// investigation that led here: the resulting app kept Electron's own
// generic prebuilt signature, Identifier=Electron, instead of
// com.anchor.desktop — the same shared-identity problem that broke
// macOS permissions the first time around in this project).
//
// This hook runs after electron-builder finishes packaging (whether or
// not IT signed anything) and calls the real `codesign` binary directly
// with its actual ad-hoc syntax (`-s -`), which needs no certificate at
// all. That's what gives the packaged app its own distinct
// com.anchor.desktop identity, so macOS's permission system (TCC) can
// finally tell it apart from every other unsigned Electron app on the
// machine instead of lumping them all together.
const { execFileSync, spawnSync } = require("child_process");
const path = require("path");

module.exports = async function afterSign(context) {
  if (context.electronPlatformName !== "darwin") return;

  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(context.appOutDir, `${appName}.app`);

  // codesign refuses to sign over leftover extended attributes
  // (resource forks / Finder info / quarantine flags) that can end up
  // on files after being copied or synced by other tools — "resource
  // fork, Finder information, or similar detritus not allowed" is
  // codesign's actual error for this. xattr -cr handles the extended
  // ATTRIBUTES; it doesn't touch actual leftover junk FILES (.DS_Store,
  // AppleDouble ._* resource-fork files) that trip the same codesign
  // error and that xattr has nothing to do with — deleting those too,
  // recursively, since a nested helper .app (inside Contents/Frameworks)
  // hit exactly this on the first pass with xattr alone. All of this is
  // a no-op on an already-clean bundle.
  console.log(`[afterSign] Removing .DS_Store / AppleDouble junk files in ${appPath} …`);
  execFileSync("find", [appPath, "-name", ".DS_Store", "-delete"], { stdio: "inherit" });
  execFileSync("find", [appPath, "-name", "._*", "-delete"], { stdio: "inherit" });

  console.log(`[afterSign] Clearing extended attributes on ${appPath} …`);
  execFileSync("xattr", ["-cr", appPath], { stdio: "inherit" });

  // `xattr -cr` clears attributes on everything INSIDE appPath plus appPath
  // itself in theory, but com.apple.FinderInfo on the top-level bundle
  // DIRECTORY has proven to survive that call in practice (Finder writes this
  // attribute onto folders it displays — window/icon layout metadata — and
  // since this bundle sits inside a folder that's open in Finder on the
  // Desktop, Finder can rewrite it at any moment, including between our -cr
  // call and the codesign call a few lines down). Belt-and-suspenders: name
  // the known-bad attributes explicitly and delete them one more time, right
  // on the bundle path itself, immediately before signing. `xattr -d` exits
  // non-zero if the attribute isn't present, which is fine and expected on a
  // clean bundle, so each call is wrapped to swallow that "not found" case.
  for (const attr of ["com.apple.FinderInfo", "com.apple.ResourceFork"]) {
    try {
      execFileSync("xattr", ["-d", attr, appPath], { stdio: "pipe" });
      console.log(`[afterSign] Removed lingering ${attr} from ${appPath}`);
    } catch (err) {
      // "No such xattr" is expected and fine; anything else, surface it.
      const msg = (err.stderr || "").toString();
      if (!/no such xattr/i.test(msg)) {
        console.warn(`[afterSign] xattr -d ${attr} on ${appPath}: ${msg.trim()}`);
      }
    }
  }

  console.log(`[afterSign] Ad-hoc signing ${appPath} …`);
  execFileSync("codesign", ["--force", "--deep", "--sign", "-", appPath], {
    stdio: "inherit",
  });

  // Verify right here, inside the same build, instead of relying on a
  // separate manual codesign run afterward — a manual re-run minutes later
  // is itself exposed to the same Finder-rewrites-FinderInfo race described
  // above (this is likely exactly what happened with the "detritus not
  // allowed" failure on a manual re-sign after an already-successful build:
  // Finder touched the bundle again in the gap). Checking immediately, in
  // the same process, right after signing, closes that gap and makes the
  // build log itself the source of truth.
  console.log(`[afterSign] Verifying signature on ${appPath} …`);
  execFileSync("codesign", ["--verify", "--deep", "--strict", "--verbose=2", appPath], {
    stdio: "inherit",
  });
  // `codesign -dv` writes its human-readable info (including Identifier=)
  // to STDERR, not stdout — execFileSync's return value only ever carries
  // stdout, so capturing it that way silently gets an empty string and
  // makes the check below always fail even on a perfectly good signature
  // (exactly what happened on the first run after moving off Desktop: the
  // "valid on disk" / "satisfies its Designated Requirement" lines a few
  // steps above prove the signing itself was already fine). spawnSync
  // gives stdout and stderr back separately, so combine both here.
  const identifierCheck = spawnSync("codesign", ["-dv", "--verbose=4", appPath], {
    encoding: "utf8",
  });
  const identifierOutput = `${identifierCheck.stdout || ""}${identifierCheck.stderr || ""}`;
  console.log(identifierOutput);
  if (!identifierOutput.includes("Identifier=com.anchor.desktop")) {
    throw new Error(
      `[afterSign] Signed, but Identifier is not com.anchor.desktop. Output:\n${identifierOutput}`
    );
  }
  console.log("[afterSign] Confirmed Identifier=com.anchor.desktop. Done.");
};
