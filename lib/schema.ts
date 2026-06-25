import { getDomain } from "./domains";
import {
  DEEP_DIVE_QUESTION,
  MOVE_NEXT_QUESTION,
  nextSectionOrder
} from "./section-state";
import type {
  AuditFinding,
  ChatMessage,
  DomainId,
  GraphDelta,
  GraphEdge,
  GraphState,
  GraphVertex,
  JsonValue
} from "./types";

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

function specsForDomain(domainId: DomainId): {
  vertexSpecs: Map<string, VertexSpec>;
  edgeSpecs: Map<string, EdgeSpec>;
} {
  const schema = getDomain(domainId).schema;
  const vertexSpecs = new Map<string, VertexSpec>(
    schema.vertices.map((entry) => [
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
  const edgeSpecs = new Map<string, EdgeSpec>(
    schema.edges.map((entry) => [
    entry["@key"],
    {
      label: entry["@key"],
      out: entry["@value"].out ?? entry["@value"].outV ?? "",
      in: entry["@value"].in ?? entry["@value"].inV ?? "",
      properties: new Set((entry["@value"].properties ?? []).map((prop) => prop.key))
    }
    ])
  );
  return { vertexSpecs, edgeSpecs };
}

export function emptyGraph(domainId: DomainId): GraphState {
  const domain = getDomain(domainId);
  const date = new Date().toISOString().slice(0, 10);
  const person: GraphVertex = {
    id: domain.root.personId,
    label: "Person",
    properties: { name: domain.root.personName }
  };
  if (!domain.root.sessionInfrastructure) {
    return { vertices: { [person.id]: person }, edges: {} };
  }
  const sessionId = newSessionId(domainId);
  const sectionId = `section:${sessionId}:1`;
  return {
    vertices: {
      [person.id]: person,
      [sessionId]: {
        id: sessionId,
        label: "KnowledgeSession",
        properties: {
          domain: domainId,
          date,
          objective: domain.root.objective ?? ""
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
      [`${person.id}-hasSession->${sessionId}`]: {
        id: `${person.id}-hasSession->${sessionId}`,
        label: "hasSession",
        out: person.id,
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

function newSessionId(domainId: DomainId): string {
  const timestamp = new Date()
    .toISOString()
    .replace(/[-:.]/g, "")
    .replace("Z", "z")
    .toLowerCase();
  const suffix = globalThis.crypto.randomUUID().replace(/-/g, "").slice(0, 8);
  return `session:${domainId}:${timestamp}:${suffix}`;
}

export function schemaReference(domainId: DomainId): string {
  const { vertexSpecs, edgeSpecs } = specsForDomain(domainId);
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

export function graphMatchesDomain(graph: GraphState, domainId: DomainId): boolean {
  const session = Object.values(graph.vertices).find(
    (vertex) => vertex.label === "KnowledgeSession"
  );
  if (domainId === "headache") return session === undefined;
  return session?.properties.domain === domainId;
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

export function activeSectionOrder(
  domainId: DomainId,
  graph: GraphState,
  messages: ChatMessage[]
): number {
  const sections = getDomain(domainId).sectionMap?.sections ?? [];
  if (sections.length === 0) return 1;
  const current = Math.max(
    1,
    ...Object.values(graph.vertices)
      .filter((vertex) => vertex.label === "SessionSection")
      .map((vertex) => Number(vertex.properties.order ?? 1))
  );
  if (messages.filter((message) => message.role === "user").length <= 1) return current;
  return nextSectionOrder(current, sections.length, messages);
}

export function sectionInfrastructureDelta(
  domainId: DomainId,
  graph: GraphState,
  sectionOrder: number
): GraphDelta {
  const domain = getDomain(domainId);
  if (!domain.root.sessionInfrastructure) return { vertices: [], edges: [] };
  const section = domain.sectionMap?.sections?.find(
    (candidate) => candidate.order === sectionOrder
  );
  const session = Object.values(graph.vertices).find(
    (vertex) => vertex.label === "KnowledgeSession"
  );
  if (!section || !session) return { vertices: [], edges: [] };
  const sectionId = `section:${session.id}:${sectionOrder}`;
  if (graph.vertices[sectionId]) return { vertices: [], edges: [] };
  return {
    vertices: [
      {
        id: sectionId,
        label: "SessionSection",
        properties: {
          sectionType: section.section_type ?? `section_${sectionOrder}`,
          order: sectionOrder,
          title: section.title ?? `Section ${sectionOrder}`,
          purpose: section.purpose ?? ""
        }
      }
    ],
    edges: [
      {
        id: `${session.id}-hasSection->${sectionId}`,
        label: "hasSection",
        out: session.id,
        in: sectionId,
        properties: {}
      }
    ]
  };
}

export function activeSectionInstruction(
  domainId: DomainId,
  sectionOrder: number
): string {
  const section = getDomain(domainId).sectionMap?.sections?.find(
    (candidate) => candidate.order === sectionOrder
  );
  if (!section) return "";
  return [
    `[ACTIVE SECTION ${sectionOrder}] ${section.title ?? section.section_type ?? ""}`,
    section.purpose ?? "",
    `Stay within this section. Ask one focused question at a time.`,
    `When this section is sufficiently covered, ask exactly: "${DEEP_DIVE_QUESTION}"`,
    `Do not enter the next section until the expert declines deeper exploration or explicitly confirms "${MOVE_NEXT_QUESTION}"`
  ].filter(Boolean).join("\n");
}

export function sanitizeDelta(
  input: unknown,
  graph: GraphState,
  domainId: DomainId,
  activeSection = 1
): {
  delta: GraphDelta;
  warnings: string[];
  errors: string[];
} {
  const domain = getDomain(domainId);
  const { vertexSpecs, edgeSpecs } = specsForDomain(domainId);
  const warnings: string[] = [];
  const raw = isRecord(input) ? input : {};
  if (!isRecord(input)) {
    warnings.push("Extractor returned non-object input.");
  }
  const rawVertices = Array.isArray(raw.vertices) ? raw.vertices : [];
  const rawEdges = Array.isArray(raw.edges) ? raw.edges : [];
  const vertices: GraphVertex[] = [];
  const ignoredIds = new Set<string>();
  const idAliases = new Map<string, string>();
  const section = domain.sectionMap?.sections?.find((item) => item.order === activeSection);
  const sectionLabels = section?.primary_vertex_labels
    ? new Set([...section.primary_vertex_labels, "SessionSection"])
    : null;
  const sectionEdges = section?.edge_patterns
    ? new Set([
        ...section.edge_patterns.map((pattern) => pattern.edge),
        ...[...edgeSpecs.values()]
          .filter((spec) => spec.in === "ProvenanceEvidence")
          .map((spec) => spec.label),
        "hasSection",
        "hasEpisode"
      ])
    : null;
  const labelsById = new Map<string, string>(
    Object.values(graph.vertices).map((vertex) => [vertex.id, vertex.label])
  );

  for (const item of rawVertices) {
    if (!isRecord(item)) {
      warnings.push("Dropped vertex: not an object.");
      continue;
    }
    let id = stringValue(item.id);
    const originalId = id;
    const label = stringValue(item.label);
    if (!id || !label) {
      warnings.push(`Dropped vertex: missing id or label (id=${JSON.stringify(item.id)}, label=${JSON.stringify(item.label)}).`);
      continue;
    }
    if (sectionLabels && !sectionLabels.has(label)) {
      warnings.push(
        `Dropped vertex ${id}: ${label} is not allowed in active section ${section?.section_id ?? activeSection}.`
      );
      ignoredIds.add(id);
      continue;
    }
    const spec = vertexSpecs.get(label);
    if (!spec) {
      warnings.push(`Dropped vertex ${id}: unknown label ${label}.`);
      continue;
    }
    const existingLabel = labelsById.get(id);
    if (existingLabel && existingLabel !== label) {
      warnings.push(
        `Dropped vertex ${id}: existing label ${existingLabel} cannot change to ${label}.`
      );
      continue;
    }
    if (label === "Person" || label === "KnowledgeSession") {
      const existing = graph.vertices[id];
      if (existing?.label !== label) {
        warnings.push(`Dropped vertex ${id}: ${label} is session infrastructure and cannot be minted.`);
        continue;
      }
    }
    const unknownProperties = unknownPropertyNames(item.properties, spec.properties);
    if (unknownProperties.length) {
      warnings.push(
        `Dropped vertex ${id}: unknown properties ${unknownProperties.join(", ")}.`
      );
      continue;
    }
    const properties = filterProperties(item.properties, spec.properties);
    const required = requiredProperties(label, spec.required);
    const missing = [...required].filter(
      (key) =>
        !(key in properties) ||
        properties[key] === null ||
        (typeof properties[key] === "string" && properties[key].trim() === "")
    );
    if (missing.length) {
      warnings.push(`Dropped vertex ${id}: missing required ${missing.join(", ")}.`);
      continue;
    }
    const typeError = firstTypeError(properties, spec.propertyTypes);
    if (typeError) {
      warnings.push(`Dropped vertex ${id}: ${typeError}.`);
      continue;
    }
    if (domain.validationProfile === "expert") {
      const existingCanonical = findCanonicalVertex(
        label,
        properties,
        graph,
        vertices
      );
      if (existingCanonical && existingCanonical.id !== id) {
        idAliases.set(id, existingCanonical.id);
        id = existingCanonical.id;
      }
    }
    const validId =
      domain.validationProfile === "headache"
        ? /^[A-Za-z0-9][A-Za-z0-9_:-]*$/.test(id)
        : /^[a-z0-9][a-z0-9:-]*[a-z0-9]$/.test(id);
    if (!validId) {
      warnings.push(`Dropped vertex ${id}: invalid deterministic id.`);
      continue;
    }
    const expectedPrefix = ID_PREFIX_BY_LABEL[label];
    if (
      domain.validationProfile === "expert" &&
      expectedPrefix &&
      !id.startsWith(expectedPrefix)
    ) {
      warnings.push(`Dropped vertex ${id}: ${label} ids must start with ${expectedPrefix}.`);
      continue;
    }
    if (id.length > 80) {
      warnings.push(`Dropped vertex ${id}: id exceeds 80 characters.`);
      continue;
    }
    if (label === "KnowledgeSession" && properties.domain !== domainId) {
      warnings.push(`Dropped vertex ${id}: KnowledgeSession domain must be ${domainId}.`);
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
    if (domainId === "hospitality" && label === "DecisionRule") {
      const ruleText = typeof properties.ruleText === "string" ? properties.ruleText.trim() : "";
      if (
        ruleText.length <= 20 ||
        [
          "if condition then action",
          "see transcript",
          "n/a",
          "unknown",
          "rule about hospitality",
          "decision rule"
        ].includes(ruleText.toLowerCase())
      ) {
        warnings.push(`Dropped vertex ${id}: DecisionRule.ruleText must exceed 20 characters.`);
        continue;
      }
    }
    if (domainId === "hospitality" && label === "OperatingHeuristic") {
      const heuristic = typeof properties.heuristic === "string" ? properties.heuristic.trim() : "";
      if (heuristic.length <= 10) {
        warnings.push(`Dropped vertex ${id}: OperatingHeuristic.heuristic must exceed 10 characters.`);
        continue;
      }
    }
    if (domainId === "hospitality" && (label === "CheckInPolicy" || label === "CheckOutPolicy")) {
      const session = Object.values(graph.vertices).find(
        (vertex) => vertex.label === "KnowledgeSession"
      );
      const policyKind = label === "CheckInPolicy" ? "checkin" : "checkout";
      const expectedId = `policy:${policyKind}:${session?.id ?? `session:${domainId}:unknown`}`;
      const existing = Object.values(graph.vertices).find((vertex) => vertex.label === label);
      const canonicalPolicyId = existing?.id ?? expectedId;
      if (id !== canonicalPolicyId) {
        idAliases.set(id, canonicalPolicyId);
        id = canonicalPolicyId;
      }
    }
    if (domain.validationProfile === "expert" && label === "ProvenanceEvidence") {
      const trace = String(properties.traceText ?? "").trim().toLowerCase();
      const banned = domainId === "hospitality" ? [
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
      ] : [
        "the expert mentioned",
        "the doctor said",
        "extracted from interview",
        "see transcript",
        "n/a",
        "not available",
        "unknown"
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
    if (domainId === "hypertension" && label === "BloodPressureMeasurement") {
      const systolic = properties.systolic;
      const diastolic = properties.diastolic;
      if (
        (typeof systolic === "number" && (systolic < 60 || systolic > 300)) ||
        (typeof diastolic === "number" && (diastolic < 30 || diastolic > 200))
      ) {
        warnings.push(`Review: BloodPressureMeasurement ${id} has physiologically implausible values.`);
      }
    }
    const existingIndex = vertices.findIndex((vertex) => vertex.id === id);
    if (existingIndex >= 0) {
      vertices[existingIndex] = {
        ...vertices[existingIndex],
        properties: {
          ...vertices[existingIndex].properties,
          ...properties
        }
      };
    } else {
      vertices.push({ id, label, properties });
    }
    labelsById.set(id, label);
    if (originalId !== id) labelsById.set(originalId, label);
  }

  const edges: GraphEdge[] = [];
  for (const item of rawEdges) {
    if (!isRecord(item)) {
      warnings.push("Dropped edge: not an object.");
      continue;
    }
    const label = stringValue(item.label);
    const rawOut = stringValue(item.out);
    const rawIncoming = stringValue(item.in);
    const out = idAliases.get(rawOut) ?? rawOut;
    const incoming = idAliases.get(rawIncoming) ?? rawIncoming;
    if (!label || !out || !incoming) {
      warnings.push(`Dropped edge: missing label, out, or in (label=${JSON.stringify(item.label)}, out=${JSON.stringify(item.out)}, in=${JSON.stringify(item.in)}).`);
      continue;
    }
    if (ignoredIds.has(out) || ignoredIds.has(incoming)) continue;
    if (sectionEdges && !sectionEdges.has(label)) {
      warnings.push(
        `Dropped edge ${label}: not allowed in active section ${section?.section_id ?? activeSection}.`
      );
      continue;
    }
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
    const id =
      domain.validationProfile === "expert"
        ? `${out}-${label}->${incoming}`
        : stringValue(item.id) || `${out}-${label}->${incoming}`;
    const unknownProperties = unknownPropertyNames(item.properties, spec.properties);
    if (unknownProperties.length) {
      warnings.push(
        `Dropped edge ${id}: unknown properties ${unknownProperties.join(", ")}.`
      );
      continue;
    }
    edges.push({
      id,
      label,
      out,
      in: incoming,
      properties: filterProperties(item.properties, spec.properties)
    });
  }

  const provenanceEdgeLabels = new Set(
    [...edgeSpecs.values()]
      .filter((spec) => spec.in === "ProvenanceEvidence")
      .map((spec) => spec.label)
  );
  const provenanceTargets = new Set(
    edges
      .filter((edge) => provenanceEdgeLabels.has(edge.label))
      .map((edge) => edge.out)
  );
  const provenanceExempt = new Set(
    domain.provenanceSpec?.attachment_rules?.exempt_vertex_labels ?? [
      "Person",
      "KnowledgeSession",
      "SessionSection",
      "TranscriptEpisode",
      "ProvenanceEvidence"
    ]
  );
  const expectedProvenanceEdges =
    domain.provenanceSpec?.attachment_rules?.edge_label_by_vertex ?? {};
  const currentEvidenceIds = new Set(
    vertices
      .filter((vertex) => vertex.label === "ProvenanceEvidence")
      .map((vertex) => vertex.id)
  );
  const currentEpisodeIds = new Set(
    vertices
      .filter((vertex) => vertex.label === "TranscriptEpisode")
      .map((vertex) => vertex.id)
  );
  const seenProvenance = new Set<string>();
  const pendingIds = new Set(vertices.map((vertex) => vertex.id));
  const infrastructureLabels = new Set([
    "Person",
    "KnowledgeSession",
    "SessionSection",
    "TranscriptEpisode",
    "ProvenanceEvidence"
  ]);
  for (const edge of edges) {
    if (provenanceEdgeLabels.has(edge.label) || edge.label === "hasEpisode" || edge.label === "hasSection" || edge.label === "hasSession") {
      continue;
    }
    for (const endpoint of [edge.out, edge.in]) {
      const endpointLabel = labelsById.get(endpoint);
      if (
        endpointLabel &&
        !infrastructureLabels.has(endpointLabel) &&
        !pendingIds.has(endpoint)
      ) {
        warnings.push(
          `${endpointLabel} ${endpoint} is enriched by ${edge.label} and must be re-emitted with provenance in this delta.`
        );
      }
    }
  }
  for (const vertex of vertices) {
    if (
      !provenanceExempt.has(vertex.label) &&
      !provenanceTargets.has(vertex.id)
    ) {
      warnings.push(
        `${vertex.label} ${vertex.id} has no schema-valid provenance edge in this delta.`
      );
    }
    const attached = edges.filter(
      (edge) => edge.out === vertex.id && provenanceEdgeLabels.has(edge.label)
    );
    const expected = expectedProvenanceEdges[vertex.label];
    if (
      expected &&
      attached.length > 0 &&
      attached.some((edge) => edge.label !== expected)
    ) {
      warnings.push(
        `${vertex.label} ${vertex.id} must use provenance edge ${expected}.`
      );
    }
    if (
      expected &&
      attached.some((edge) => !currentEvidenceIds.has(edge.in))
    ) {
      warnings.push(
        `${vertex.label} ${vertex.id} must target ProvenanceEvidence emitted in this delta.`
      );
    }
    if (vertex.label === "ProvenanceEvidence") {
      const sourceEpisode = String(vertex.properties.sourceEpisode ?? "");
      const provenanceKey = `${sourceEpisode}\u0000${String(vertex.properties.traceText ?? "").trim().toLowerCase()}`;
      if (seenProvenance.has(provenanceKey)) {
        warnings.push(
          `Review: duplicate provenance for source episode ${sourceEpisode}; reuse one evidence vertex.`
        );
      }
      seenProvenance.add(provenanceKey);
      const sourceExists = currentEpisodeIds.has(sourceEpisode);
      if (!sourceExists) {
        warnings.push(
          `Review: Provenance ${vertex.id} references missing source episode ${sourceEpisode}.`
        );
      }
    }
  }

  if (
    domain.root.sessionInfrastructure &&
    !Object.values(graph.vertices).some((vertex) => vertex.label === "KnowledgeSession")
  ) {
    warnings.push("Dropped delta: active KnowledgeSession root is missing.");
  }
  const errors = warnings.filter((warning) => !warning.startsWith("Review:"));
  return {
    delta: {
      vertices,
      edges
    },
    warnings: warnings.filter((warning) => warning.startsWith("Review:")),
    errors
  };
}

export function validateSessionGraph(
  graph: GraphState,
  domainId: DomainId
): AuditFinding[] {
  if (domainId === "headache") return [];
  const findings: AuditFinding[] = [];
  const vertices = Object.values(graph.vertices);
  const edges = Object.values(graph.edges);
  const byLabel = (label: string) => vertices.filter((vertex) => vertex.label === label);
  const edgeFrom = (id: string, labels?: string[]) =>
    edges.filter((edge) => edge.out === id && (!labels || labels.includes(edge.label)));
  const normalizedNames = (label: string, property: string) => {
    const counts = new Map<string, number>();
    for (const vertex of byLabel(label)) {
      const value = normalizedIdentity(vertex.properties[property]);
      if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    return counts;
  };

  for (const evidence of byLabel("ProvenanceEvidence")) {
    const source = String(evidence.properties.sourceEpisode ?? "");
    if (!graph.vertices[source] || graph.vertices[source].label !== "TranscriptEpisode") {
      findings.push({
        ruleId: domainId === "hospitality" ? "HR025" : "PV002",
        severity: "soft",
        message: `Provenance ${evidence.id} references missing episode ${source}.`
      });
    }
  }

  if (domainId === "hypertension") {
    for (const measurement of byLabel("BloodPressureMeasurement")) {
      const systolic = measurement.properties.systolic;
      const diastolic = measurement.properties.diastolic;
      if (
        (typeof systolic === "number" && (systolic < 60 || systolic > 300)) ||
        (typeof diastolic === "number" && (diastolic < 30 || diastolic > 200))
      ) {
        findings.push({
          ruleId: "R011",
          severity: "soft",
          message: `Blood pressure measurement ${measurement.id} is physiologically implausible.`
        });
      }
    }
    return findings;
  }

  const sectionTypes = new Set(
    byLabel("SessionSection").map((vertex) => String(vertex.properties.sectionType))
  );
  for (const [type, title] of [
    ["introduction", "Introduction"],
    ["guest_experience_principles", "Guest Experience Principles"],
    ["arrival_checkin_timing", "Arrival, Check-In, and Timing"]
  ]) {
    if (!sectionTypes.has(type)) {
      findings.push({
        ruleId: "HR016",
        severity: "soft",
        message: `Missing required section: ${title}.`
      });
    }
  }

  for (const [label, ruleId] of [
    ["GuestPersona", "HR017"],
    ["GuestSignal", "HR018"]
  ]) {
    for (const [name, count] of normalizedNames(label, "name")) {
      if (count > 1) {
        findings.push({
          ruleId,
          severity: "soft",
          message: `${count} ${label} vertices share normalized name "${name}".`
        });
      }
    }
  }

  for (const [label, ruleId] of [
    ["CheckInPolicy", "HR019"],
    ["CheckOutPolicy", "HR020"]
  ]) {
    const count = byLabel(label).length;
    if (count !== 1) {
      findings.push({
        ruleId,
        severity: "soft",
        message: `Expected exactly one ${label}; found ${count}.`
      });
    }
  }

  for (const failure of byLabel("ServiceFailure")) {
    if (edgeFrom(failure.id, ["resolvedBy"]).length === 0) {
      findings.push({
        ruleId: "HR021",
        severity: "advisory",
        message: `ServiceFailure ${failure.id} has no recovery action.`
      });
    }
  }

  for (const rule of byLabel("DecisionRule")) {
    const incoming = edges.some((edge) => edge.in === rule.id);
    const outgoing = edges.some(
      (edge) => edge.out === rule.id && edge.label !== "supportedBy"
    );
    if (!incoming || !outgoing) {
      findings.push({
        ruleId: "HR022",
        severity: "advisory",
        message: `DecisionRule ${rule.id} is missing incoming or causal outgoing context.`
      });
    }
  }

  for (const loyalty of byLabel("LoyaltyDriver")) {
    if (edgeFrom(loyalty.id, ["drivenBy", "loyaltyLeadsTo"]).length === 0) {
      findings.push({
        ruleId: "HR023",
        severity: "advisory",
        message: `LoyaltyDriver ${loyalty.id} is not linked to a persona or outcome.`
      });
    }
  }

  for (const [label, minimum] of Object.entries({
    GuestExperiencePrinciple: 3,
    DecisionRule: 3,
    GuestPersona: 2,
    OperatingHeuristic: 2,
    TimingRule: 1
  })) {
    const count = byLabel(label).length;
    if (count < minimum) {
      findings.push({
        ruleId: "HR024",
        severity: "advisory",
        message: `${label} count ${count} is below expected minimum ${minimum}.`
      });
    }
  }
  return findings;
}

function filterProperties(input: unknown, allowed: Set<string>): Record<string, JsonValue> {
  if (!isRecord(input)) return {};
  const out: Record<string, JsonValue> = {};
  for (const [key, value] of Object.entries(input)) {
    if (allowed.has(key) && isJsonValue(value)) out[key] = value;
  }
  return out;
}

function unknownPropertyNames(input: unknown, allowed: Set<string>): string[] {
  if (!isRecord(input)) return [];
  return Object.keys(input).filter((key) => !allowed.has(key));
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

const IDENTITY_PROPERTY_BY_LABEL: Record<string, string> = {
  GuestExperiencePrinciple: "name",
  ServiceStandard: "name",
  GuestSignal: "name",
  GuestPersona: "name",
  TimingRule: "ruleText",
  ServiceFailure: "name",
  RecoveryAction: "name",
  ExceptionRule: "ruleText",
  DecisionRule: "ruleText",
  OperatingHeuristic: "name",
  LoyaltyDriver: "name",
  EmotionalMoment: "name",
  HypertensionConcept: "name",
  DiagnosticCriterion: "criterionName",
  ClinicalFinding: "name",
  Symptom: "name",
  Comorbidity: "name",
  RiskFactor: "name",
  SecondaryCause: "name",
  DiagnosticTest: "testName",
  Medication: "name",
  LifestyleIntervention: "name",
  ClinicalReasoningPattern: "patternName",
  Pitfall: "description"
};

const ID_PREFIX_BY_LABEL: Record<string, string> = {
  Person: "person:",
  KnowledgeSession: "session:",
  SessionSection: "section:",
  TranscriptEpisode: "ep:",
  ProvenanceEvidence: "prov:",
  GuestExperiencePrinciple: "principle:",
  ServiceStandard: "standard:",
  GuestSignal: "signal:",
  GuestPersona: "persona:",
  CheckInPolicy: "policy:checkin:",
  CheckOutPolicy: "policy:checkout:",
  TimingRule: "timing:",
  ServiceFailure: "failure:",
  RecoveryAction: "recovery:",
  ExceptionRule: "exception:",
  DecisionRule: "rule:",
  OperatingHeuristic: "heuristic:",
  LoyaltyDriver: "loyalty:",
  EmotionalMoment: "moment:",
  HypertensionConcept: "concept:",
  BloodPressureMeasurement: "bp:",
  DiagnosticCriterion: "criterion:",
  ClinicalFinding: "finding:",
  Symptom: "symptom:",
  Comorbidity: "comorbidity:",
  RiskFactor: "riskfactor:",
  SecondaryCause: "secondary:",
  DiagnosticTest: "test:",
  Medication: "med:",
  LifestyleIntervention: "lifestyle:",
  FollowUpPlan: "followup:",
  ClinicalReasoningPattern: "pattern:",
  Pitfall: "pitfall:",
  CaseScenario: "case:",
  ContextualConstraint: "constraint:",
  Outcome: "outcome:"
};

function findCanonicalVertex(
  label: string,
  properties: Record<string, JsonValue>,
  graph: GraphState,
  pending: GraphVertex[]
): GraphVertex | undefined {
  const property = IDENTITY_PROPERTY_BY_LABEL[label];
  if (!property) return undefined;
  const identity = normalizedIdentity(properties[property]);
  if (!identity) return undefined;
  return [...Object.values(graph.vertices), ...pending].find(
    (vertex) =>
      vertex.label === label &&
      normalizedIdentity(vertex.properties[property]) === identity
  );
}

function normalizedIdentity(value: JsonValue | undefined): string {
  return typeof value === "string"
    ? value.trim().toLowerCase().replace(/\s+/g, " ")
    : "";
}
