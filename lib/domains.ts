import hospitalitySchemaRaw from "../hospitality/schema hospitality.json";
import headacheSchemaRaw from "../src/main/json/medical.json";
import hypertensionSchemaRaw from "../hypertension/hypertension schema.json";
import hospitalityProvenanceSpecRaw from "../hospitality/provenance spec.json";
import hospitalitySectionMapRaw from "../hospitality/section map.json";
import hospitalityValidationRulesRaw from "../hospitality/validation rules.json";
import hypertensionProvenanceSpecRaw from "../hypertension/provenance spec.json";
import hypertensionSectionMapRaw from "../hypertension/section map.json";
import {
  HEADACHE_AGENT_PROMPT,
  HEADACHE_EXTRACTOR_INTRO,
  HEADACHE_OPENING_LINE,
  HOSPITALITY_AGENT_PROMPT,
  HOSPITALITY_EXTRACTOR_INTRO,
  HOSPITALITY_OPENING_LINE,
  HYPERTENSION_AGENT_PROMPT,
  HYPERTENSION_EXTRACTOR_INTRO,
  HYPERTENSION_OPENING_LINE
} from "./prompts";
import type { DomainId } from "./types";

export type DomainDescriptor = {
  id: DomainId;
  label: string;
  participantLabel: string;
  roleDescription: string;
  composerPlaceholder: string;
  openingLine: string;
  conversationPrompt: string;
  extractorPrompt: string;
  conversationPromptPath: string;
  extractorPromptPath: string;
  schemaPath: string;
  sectionMapPath?: string;
  validationRulesPath?: string;
  provenanceSpecPath?: string;
  idConvention: string;
  schema: PropertyGraphSchema;
  sectionMap?: SectionMap;
  provenanceSpec?: ProvenanceSpec;
  validationRules?: ValidationRules;
  root: {
    personId: string;
    personName: string;
    sessionInfrastructure: boolean;
    objective?: string;
  };
  validationProfile: "headache" | "expert";
};

export type PropertyGraphSchema = {
  vertices: Array<{
    "@key": string;
    "@value": {
      properties?: Array<{ key: string; value?: unknown; required?: boolean }>;
    };
  }>;
  edges: Array<{
    "@key": string;
    "@value": {
      out?: string;
      in?: string;
      outV?: string;
      inV?: string;
      properties?: Array<{ key: string; value?: unknown; required?: boolean }>;
    };
  }>;
};

export type SectionDefinition = {
  order: number;
  section_id?: string;
  section_type?: string;
  title?: string;
  purpose?: string;
  capture_goals?: string[];
  primary_vertex_labels?: string[];
  edge_patterns?: Array<{ edge: string; out: string; in: string }>;
  extractor_instruction?: string;
};

export type SectionMap = {
  sections?: Array<{
    order: number;
    section_id?: string;
    section_type?: string;
    title?: string;
    purpose?: string;
    capture_goals?: string[];
    primary_vertex_labels?: string[];
    edge_patterns?: Array<{ edge: string; out: string; in: string }>;
    extractor_instruction?: string;
  }>;
  global_extractor_rules?: Record<string, string>;
};

type ProvenanceSpec = {
  attachment_rules?: {
    edge_label_by_vertex?: Record<string, string>;
    exempt_vertex_labels?: string[];
  };
  validation?: {
    checks?: Array<Record<string, unknown>>;
  };
};

type ValidationRules = {
  rules?: Array<{
    rule_id: string;
    name: string;
    scope: string;
    severity: "hard" | "soft" | "advisory";
  }>;
};

export const DOMAIN_REGISTRY: Record<DomainId, DomainDescriptor> = {
  headache: {
    id: "headache",
    label: "headache",
    participantLabel: "patient",
    roleDescription: "headache interview assistant",
    composerPlaceholder: "Describe your headaches in your own words",
    openingLine: HEADACHE_OPENING_LINE,
    conversationPrompt: HEADACHE_AGENT_PROMPT,
    extractorPrompt: HEADACHE_EXTRACTOR_INTRO,
    conversationPromptPath: "lib/prompts.ts#HEADACHE_AGENT_PROMPT",
    extractorPromptPath: "lib/prompts.ts#HEADACHE_EXTRACTOR_INTRO",
    schemaPath: "src/main/json/medical.json",
    idConvention: "Headache:{slug}; vocabulary Label:{value-slug}",
    schema: headacheSchemaRaw as PropertyGraphSchema,
    root: {
      personId: "Person:patient",
      personName: "patient",
      sessionInfrastructure: false
    },
    validationProfile: "headache"
  },
  hypertension: {
    id: "hypertension",
    label: "hypertension",
    participantLabel: "expert",
    roleDescription: "hypertension knowledge engineer",
    composerPlaceholder: "Share your hypertension expertise",
    openingLine: HYPERTENSION_OPENING_LINE,
    conversationPrompt: HYPERTENSION_AGENT_PROMPT,
    extractorPrompt: HYPERTENSION_EXTRACTOR_INTRO,
    conversationPromptPath: "lib/prompts.ts#HYPERTENSION_AGENT_PROMPT",
    extractorPromptPath: "lib/prompts.ts#HYPERTENSION_EXTRACTOR_INTRO",
    schemaPath: "hypertension/hypertension schema.json",
    sectionMapPath: "hypertension/section map.json",
    validationRulesPath: "hypertension/validation rules.json",
    provenanceSpecPath: "hypertension/provenance spec.json",
    idConvention: "lowercase colon-namespaced slugs",
    schema: hypertensionSchemaRaw as PropertyGraphSchema,
    sectionMap: hypertensionSectionMapRaw as SectionMap,
    provenanceSpec: hypertensionProvenanceSpecRaw as ProvenanceSpec,
    root: {
      personId: "person:expert",
      personName: "Hypertension expert",
      sessionInfrastructure: true,
      objective: "Capture senior-clinician hypertension expertise"
    },
    validationProfile: "expert"
  },
  hospitality: {
    id: "hospitality",
    label: "hospitality",
    participantLabel: "expert",
    roleDescription: "hospitality knowledge engineer",
    composerPlaceholder: "Share your hospitality expertise",
    openingLine: HOSPITALITY_OPENING_LINE,
    conversationPrompt: HOSPITALITY_AGENT_PROMPT,
    extractorPrompt: HOSPITALITY_EXTRACTOR_INTRO,
    conversationPromptPath: "lib/prompts.ts#HOSPITALITY_AGENT_PROMPT",
    extractorPromptPath: "lib/prompts.ts#HOSPITALITY_EXTRACTOR_INTRO",
    schemaPath: "hospitality/schema hospitality.json",
    sectionMapPath: "hospitality/section map.json",
    validationRulesPath: "hospitality/validation rules.json",
    provenanceSpecPath: "hospitality/provenance spec.json",
    idConvention: "lowercase colon-namespaced slugs, maximum 80 characters",
    schema: hospitalitySchemaRaw as PropertyGraphSchema,
    sectionMap: hospitalitySectionMapRaw as SectionMap,
    provenanceSpec: hospitalityProvenanceSpecRaw as ProvenanceSpec,
    validationRules: hospitalityValidationRulesRaw as ValidationRules,
    root: {
      personId: "person:expert",
      personName: "Hospitality expert",
      sessionInfrastructure: true,
      objective: "Capture hospitality operating expertise"
    },
    validationProfile: "expert"
  }
};

export const DOMAIN_OPTIONS = Object.values(DOMAIN_REGISTRY).map(({ id, label }) => ({
  id,
  label
}));

export function getDomain(domainId: DomainId): DomainDescriptor {
  return DOMAIN_REGISTRY[domainId];
}

export function isDomainId(value: unknown): value is DomainId {
  return typeof value === "string" && value in DOMAIN_REGISTRY;
}
