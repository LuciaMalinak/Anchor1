import type { IndustryKey } from "./industries";
import { INDUSTRY_PLAYBOOKS, type IndustryPlaybook } from "./industryPlaybooks";
import { toolsForIndustry, type IndustryTool, type ToolKind, type ToolPhase } from "./industryTools";

// A team's own specialty, researched from its website (specialtyBuilder.ts):
// not "Hospitality" but "ultra-luxury hotel asset management", with a
// playbook written for that business and expert tools made just for it.
// When a team has one, its playbook replaces the industry's for live
// coaching, live answers, summaries and reports, and its tools sit first
// in the tools launcher. Definitions only: no database imports, so pages
// and client components can use it.

export type SpecialtyTool = {
  id: string; // "x_<slug>", unique within the team
  name: string;
  kind: ToolKind;
  phase: ToolPhase;
  outcome: string;
  instructions: string;
  clientFacing?: boolean;
  needsTranscript?: boolean;
};

export type TeamSpecialty = {
  website: string | null;
  companyName: string;
  // Short name for the sector, e.g. "Ultra-luxury hotel asset management".
  sectorName: string;
  // What the company does, in two or three sentences.
  summary: string;
  playbook: IndustryPlaybook;
  tools: SpecialtyTool[];
  generatedAt: string;
};

// The playbook a team's calls are coached and summarized with: its own
// specialty's when it has one, otherwise its industry's.
export function teamPlaybook(industry: IndustryKey | null, specialty: TeamSpecialty | null | undefined): IndustryPlaybook | null {
  if (specialty?.playbook) return specialty.playbook;
  return industry ? INDUSTRY_PLAYBOOKS[industry] ?? null : null;
}

export function specialtyToolToIndustryTool(t: SpecialtyTool): IndustryTool & { custom: true } {
  return {
    id: t.id,
    industries: [],
    phase: t.phase,
    kind: t.kind,
    name: t.name,
    outcome: t.outcome,
    instructions: t.instructions,
    clientFacing: t.clientFacing,
    needsTranscript: t.needsTranscript,
    custom: true,
  };
}

// Every tool a team gets: the ones made for its specialty first, then its
// industry's, then the ones for everyone.
export function toolsForTeam(industry: IndustryKey | null, specialty: TeamSpecialty | null | undefined): (IndustryTool & { custom?: boolean })[] {
  return [...(specialty?.tools ?? []).map(specialtyToolToIndustryTool), ...toolsForIndustry(industry)];
}
