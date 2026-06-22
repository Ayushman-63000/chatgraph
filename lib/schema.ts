import hospitalitySchemaRaw from "../src/main/json/hospitality.json";
import type { GraphDelta, GraphEdge, GraphState, GraphVertex, JsonValue } from "./types";

type SchemaProperty = {
  key: string;
  value?: unknown;
  required?: boolean;
};

type SchemaVertexEntry = {
  "@key": string;
  "@value": {
    properties?: SchemaProperty[];
  };
};

type SchemaEdgeEntry = {
  "@key": string;
  "@value": {
    out: string;
    in: string;
    properties?: SchemaProperty[];
  };
};

type PropertyGraphSchema = {
  vertices: SchemaVertexEntry[];
  edges: SchemaEdgeEntry[];
};

const hospitalitySchema = hospitalitySchemaRaw as PropertyGraphSchema;

export type VertexSpec = {
  label: string;
  properties: Set<string>;
  propertyTypes: Map<string, string>;
  required: Set<string>;
};

export type EdgeSpec = {
  label: string;
  out: string;
  in: string;
  properties: Set<string>;
};

export const vertexSpecs = new Map<string, VertexSpec>(
  hospitalitySchema.vertices.map((entry) => [
    entry["@key"],
    {
      label: entry["@key"],
      properties: new Set((entry["@value"].properties ?? []).map((prop) => prop.key)),
      propertyTypes: new Map(
        (entry["@value"].properties ?? []).map((prop) => [prop.key, literalType(prop.value)])
      ),
      required: new Set(
        (entry["@value"].properties ?? [])
          .filter((prop) => prop.required)
          .map((prop) => prop.key)
      )
    }
  ])
);

export const edgeSpecs = new Map<string, EdgeSpec>(
  hospitalitySchema.edges.map((entry) => [
    entry["@key"],
    {
      label: entry["@key"],
      out: entry["@value"].out,
      in: entry["@value"].in,
      properties: new Set((entry["@value"].properties ?? []).map((prop) => prop.key))
    }
  ])
);

export function emptyGraph(): GraphState {
  const date = new Date().toISOString().slice(0, 10);
  const sessionId = `session:hospitality:${date}`;
  const sectionId = `section:${sessionId}:1`;
  return {
    vertices: {
      "person:expert": {
        id: "person:expert",
        label: "Person",
        properties: { name: "Hospitality expert" }
      },
      [sessionId]: {
        id: sessionId,
        label: "KnowledgeSession",
        properties: {
          domain: "hospitality",
          date,
          objective: "Capture hospitality operating expertise for a comprehensive knowledge base"
        }
      },
      [sectionId]: {
        id: sectionId,
        label: "SessionSection",
        properties: {
          sectionType: "introduction",
          order: 1,
          title: "Introduction"
        }
      }
    },
    edges: {
      [`person:expert-hasSession->${sessionId}`]: {
        id: `person:expert-hasSession->${sessionId}`,
        label: "hasSession",
        out: "person:expert",
        in: sessionId,
        properties: {}
      },
      [`${sessionId}-hasSection->${sectionId}`]: {
        id: `${sessionId}-hasSection->${sectionId}`,
        label: "hasSection",
        out: sessionId,
        in: sectionId,
        properties: {}
      }
    }
  };
}

export function schemaReference(): string {
  const vertexLines = [...vertexSpecs.values()]
    .map((spec) => {
      const props = [...spec.properties].sort();
      return props.length ? `${spec.label}: ${props.join(", ")}` : `${spec.label}: no properties`;
    })
    .join("\n");
  const edgeLines = [...edgeSpecs.values()]
    .map((spec) => {
      const props = [...spec.properties].sort();
      const suffix = props.length ? ` (${props.join(", ")})` : "";
      return `${spec.label}: ${spec.out} -> ${spec.in}${suffix}`;
    })
    .join("\n");

  return `VERTICES\n${vertexLines}\n\nEDGES\n${edgeLines}`;
}

export function graphSummary(graph: GraphState): string {
  const vertices = Object.values(graph.vertices)
    .slice(0, 160)
    .map((vertex) => {
      const props = Object.entries(vertex.properties ?? {})
        .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
        .join(", ");
      return props ? `${vertex.label} [${vertex.id}] {${props}}` : `${vertex.label} [${vertex.id}]`;
    });
  const edges = Object.values(graph.edges)
    .slice(0, 220)
    .map((edge) => `${edge.out} --${edge.label}--> ${edge.in}`);
  return `Vertices:\n${vertices.join("\n") || "(none)"}\n\nEdges:\n${edges.join("\n") || "(none)"}`;
}

export function mergeDelta(graph: GraphState, delta: GraphDelta): GraphState {
  const next: GraphState = {
    vertices: { ...graph.vertices },
    edges: { ...graph.edges }
  };
  for (const vertex of delta.vertices) {
    next.vertices[vertex.id] = {
      ...vertex,
      properties: {
        ...(next.vertices[vertex.id]?.properties ?? {}),
        ...(vertex.properties ?? {})
      }
    };
  }
  for (const edge of delta.edges) {
    next.edges[edge.id] = {
      ...edge,
      properties: {
        ...(next.edges[edge.id]?.properties ?? {}),
        ...(edge.properties ?? {})
      }
    };
  }
  return next;
}

export function sanitizeDelta(input: unknown, graph: GraphState): {
  delta: GraphDelta;
  warnings: string[];
} {
  const warnings: string[] = [];
  const raw = isRecord(input) ? input : {};
  if (!isRecord(input)) {
    warnings.push("Extractor returned non-object input.");
  }
  const rawVertices = Array.isArray(raw.vertices) ? raw.vertices : [];
  const rawEdges = Array.isArray(raw.edges) ? raw.edges : [];
  const vertices: GraphVertex[] = [];
  const ignoredIds = new Set<string>();
  const existingMaxSection = Math.max(
    0,
    ...Object.values(graph.vertices)
      .filter((vertex) => vertex.label === "SessionSection")
      .map((vertex) => Number(vertex.properties.order ?? 0))
  );
  const emittedLaterSection = rawVertices.some(
    (item) =>
      isRecord(item) &&
      item.label === "SessionSection" &&
      isRecord(item.properties) &&
      typeof item.properties.order === "number" &&
      item.properties.order > 1
  );
  const introductionOnly = existingMaxSection <= 1 && !emittedLaterSection;
  const labelsById = new Map<string, string>(
    Object.values(graph.vertices).map((vertex) => [vertex.id, vertex.label])
  );

  for (const item of rawVertices) {
    if (!isRecord(item)) {
      warnings.push("Dropped vertex: not an object.");
      continue;
    }
    const id = stringValue(item.id);
    const label = stringValue(item.label);
    if (!id || !label) {
      warnings.push(`Dropped vertex: missing id or label (id=${JSON.stringify(item.id)}, label=${JSON.stringify(item.label)}).`);
      continue;
    }
    if (
      introductionOnly &&
      !["Person", "KnowledgeSession", "SessionSection", "TranscriptEpisode"].includes(label)
    ) {
      ignoredIds.add(id);
      continue;
    }
    const spec = vertexSpecs.get(label);
    if (!spec) {
      warnings.push(`Dropped vertex ${id}: unknown label ${label}.`);
      continue;
    }
    if (label === "Person" || label === "KnowledgeSession") {
      const existing = graph.vertices[id];
      if (existing?.label !== label) {
        warnings.push(`Dropped vertex ${id}: ${label} is session infrastructure and cannot be minted.`);
        continue;
      }
    }
    const properties = filterProperties(item.properties, spec.properties);
    const required = requiredProperties(label, spec.required);
    const missing = [...required].filter((key) => !(key in properties));
    if (missing.length) {
      warnings.push(`Dropped vertex ${id}: missing required ${missing.join(", ")}.`);
      continue;
    }
    const typeError = firstTypeError(properties, spec.propertyTypes);
    if (typeError) {
      warnings.push(`Dropped vertex ${id}: ${typeError}.`);
      continue;
    }
    if (!/^[a-z0-9][a-z0-9:-]*[a-z0-9]$/.test(id)) {
      warnings.push(`Dropped vertex ${id}: invalid lowercase slug id.`);
      continue;
    }
    if (id.length > 80) {
      warnings.push(`Dropped vertex ${id}: id exceeds 80 characters.`);
      continue;
    }
    if (label === "KnowledgeSession" && properties.domain !== "hospitality") {
      warnings.push(`Dropped vertex ${id}: KnowledgeSession domain must be hospitality.`);
      continue;
    }
    if (
      label === "SessionSection" &&
      (typeof properties.order !== "number" ||
        !Number.isInteger(properties.order) ||
        properties.order < 1 ||
        properties.order > 7)
    ) {
      warnings.push(`Dropped vertex ${id}: SessionSection.order must be an integer from 1 to 7.`);
      continue;
    }
    if (label === "DecisionRule") {
      const ruleText = typeof properties.ruleText === "string" ? properties.ruleText.trim() : "";
      if (ruleText.length <= 20) {
        warnings.push(`Dropped vertex ${id}: DecisionRule.ruleText must exceed 20 characters.`);
        continue;
      }
    }
    if (label === "OperatingHeuristic") {
      const heuristic = typeof properties.heuristic === "string" ? properties.heuristic.trim() : "";
      if (heuristic.length <= 10) {
        warnings.push(`Dropped vertex ${id}: OperatingHeuristic.heuristic must exceed 10 characters.`);
        continue;
      }
    }
    if (label === "CheckInPolicy" || label === "CheckOutPolicy") {
      const session = Object.values(graph.vertices).find(
        (vertex) => vertex.label === "KnowledgeSession"
      );
      const policyKind = label === "CheckInPolicy" ? "checkin" : "checkout";
      const expectedId = `policy:${policyKind}:${session?.id ?? "session:hospitality:unknown"}`;
      const existing = Object.values(graph.vertices).find((vertex) => vertex.label === label);
      if (existing && existing.id !== id) {
        warnings.push(`Dropped vertex ${id}: reuse singleton ${label} id ${existing.id}.`);
        continue;
      }
      if (id !== expectedId) {
        warnings.push(`Dropped vertex ${id}: ${label} id must be ${expectedId}.`);
        continue;
      }
    }
    if (
      label === "GuestPersona" &&
      Object.values(graph.vertices).some(
        (vertex) =>
          vertex.label === label &&
          vertex.id !== id &&
          String(vertex.properties.name ?? "").toLowerCase() ===
            String(properties.name ?? "").toLowerCase()
      )
    ) {
      warnings.push(`Dropped vertex ${id}: reuse existing GuestPersona with the same name.`);
      continue;
    }
    if (
      label === "GuestSignal" &&
      Object.values(graph.vertices).some(
        (vertex) =>
          vertex.label === label &&
          vertex.id !== id &&
          String(vertex.properties.name ?? "").toLowerCase() ===
            String(properties.name ?? "").toLowerCase()
      )
    ) {
      warnings.push(`Dropped vertex ${id}: reuse existing GuestSignal with the same name.`);
      continue;
    }
    if (label === "ProvenanceEvidence") {
      const trace = String(properties.traceText ?? "").trim().toLowerCase();
      const banned = [
        "the expert described their approach",
        "the owner mentioned",
        "hospitality knowledge",
        "extracted from interview",
        "see transcript",
        "n/a",
        "not available",
        "unknown",
        "the expert talked about",
        "general hospitality principle"
      ];
      if (!trace || banned.some((prefix) => trace.startsWith(prefix))) {
        warnings.push(`Dropped vertex ${id}: provenance traceText is empty or generic.`);
        continue;
      }
      if (!["expert", "interviewer", "system"].includes(String(properties.speaker))) {
        warnings.push(`Dropped vertex ${id}: provenance speaker must be expert, interviewer, or system.`);
        continue;
      }
      if (
        properties.confidence !== undefined &&
        !["high", "medium", "low", "inferred"].includes(String(properties.confidence))
      ) {
        warnings.push(`Dropped vertex ${id}: invalid provenance confidence.`);
        continue;
      }
      if (
        properties.confidence === "inferred" &&
        (String(properties.traceText).match(/ep:/g)?.length ?? 0) < 2
      ) {
        warnings.push(`Review: Provenance ${id} is inferred but cites fewer than 2 episode ids.`);
      }
    }
    vertices.push({ id, label, properties });
    labelsById.set(id, label);
  }

  const edges: GraphEdge[] = [];
  for (const item of rawEdges) {
    if (!isRecord(item)) {
      warnings.push("Dropped edge: not an object.");
      continue;
    }
    const label = stringValue(item.label);
    const out = stringValue(item.out);
    const incoming = stringValue(item.in);
    if (!label || !out || !incoming) {
      warnings.push(`Dropped edge: missing label, out, or in (label=${JSON.stringify(item.label)}, out=${JSON.stringify(item.out)}, in=${JSON.stringify(item.in)}).`);
      continue;
    }
    if (ignoredIds.has(out) || ignoredIds.has(incoming)) continue;
    if (out === incoming) {
      warnings.push(`Dropped edge ${label}: self-referencing edges are not permitted.`);
      continue;
    }
    const spec = edgeSpecs.get(label);
    if (!spec) {
      warnings.push(`Dropped edge ${label}: unknown edge label.`);
      continue;
    }
    const outLabel = labelsById.get(out);
    const inLabel = labelsById.get(incoming);
    if (outLabel !== spec.out || inLabel !== spec.in) {
      warnings.push(`Dropped edge ${label}: expected ${spec.out}->${spec.in}.`);
      continue;
    }
    const id = stringValue(item.id) || `${out}-${label}->${incoming}`;
    edges.push({
      id,
      label,
      out,
      in: incoming,
      properties: filterProperties(item.properties, spec.properties)
    });
  }

  const provenanceTargets = new Set(
    [...Object.values(graph.edges), ...edges]
      .filter((edge) =>
        ["supportedBy", "principleSupportedBy", "heuristicSupportedBy"].includes(edge.label)
      )
      .map((edge) => edge.out)
  );
  const knowledgeLabels = new Set([
    "GuestExperiencePrinciple", "ServiceStandard", "GuestSignal", "GuestPersona",
    "CheckInPolicy", "CheckOutPolicy", "TimingRule", "ServiceFailure", "RecoveryAction",
    "ExceptionRule", "DecisionRule", "OperatingHeuristic", "LoyaltyDriver",
    "EmotionalMoment", "ContextualConstraint", "Outcome"
  ]);
  const invalidProvenanceIds = new Set<string>();
  for (const vertex of vertices) {
    if (knowledgeLabels.has(vertex.label) && !provenanceTargets.has(vertex.id)) {
      warnings.push(
        `Review: ${vertex.label} ${vertex.id} has no schema-valid provenance edge.`
      );
    }
    if (vertex.label === "ProvenanceEvidence") {
      const sourceEpisode = String(vertex.properties.sourceEpisode ?? "");
      const sourceExists =
        labelsById.get(sourceEpisode) === "TranscriptEpisode" ||
        graph.vertices[sourceEpisode]?.label === "TranscriptEpisode";
      if (!sourceExists) {
        warnings.push(`Dropped provenance ${vertex.id}: source episode ${sourceEpisode} does not exist.`);
        invalidProvenanceIds.add(vertex.id);
      }
    }
  }

  return {
    delta: {
      vertices: vertices.filter((vertex) => !invalidProvenanceIds.has(vertex.id)),
      edges: edges.filter(
        (edge) =>
          !invalidProvenanceIds.has(edge.out) && !invalidProvenanceIds.has(edge.in)
      )
    },
    warnings
  };
}

function filterProperties(input: unknown, allowed: Set<string>): Record<string, JsonValue> {
  if (!isRecord(input)) return {};
  const out: Record<string, JsonValue> = {};
  for (const [key, value] of Object.entries(input)) {
    if (allowed.has(key) && isJsonValue(value)) out[key] = value;
  }
  return out;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null) return true;
  if (["string", "number", "boolean"].includes(typeof value)) return true;
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (isRecord(value)) return Object.values(value).every(isJsonValue);
  return false;
}

function literalType(value: unknown): string {
  let node = value;
  let type = "unknown";
  while (isRecord(node) && Object.keys(node).length > 0) {
    type = Object.keys(node)[0];
    node = node[type];
  }
  return type;
}

function requiredProperties(label: string, schemaRequired: Set<string>): Set<string> {
  const required = new Set(schemaRequired);
  if (label === "ProvenanceEvidence") {
    required.add("sourceEpisode");
    required.add("speaker");
  }
  return required;
}

function firstTypeError(
  properties: Record<string, JsonValue>,
  propertyTypes: Map<string, string>
): string | null {
  for (const [key, value] of Object.entries(properties)) {
    const expected = propertyTypes.get(key);
    if (!expected) continue;
    const valid =
      expected === "string"
        ? typeof value === "string"
        : expected === "int32"
          ? typeof value === "number" && Number.isInteger(value)
          : expected === "boolean"
            ? typeof value === "boolean"
            : true;
    if (!valid) return `${key} must be ${expected}`;
  }
  return null;
}
