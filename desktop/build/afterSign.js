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
const { execFileSync } = require("child_process");
const path = require("path");

module.exports = async function afterSign(context) {
  if (context.electronPlatformName !== "darwin") return;

  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(context.appOutDir, `${appName}.app`);

  console.log(`[afterSign] Ad-hoc signing ${appPath} …`);
  execFileSync("codesign", ["--force", "--deep", "--sign", "-", appPath], {
    stdio: "inherit",
  });
  console.log("[afterSign] Done.");
};
