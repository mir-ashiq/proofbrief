// ProofBrief — synthetic demo cases.
// All companies, documents, and figures below are synthetic. No real customer data.

export interface SourceDoc {
  id: string;
  title: string;
  text: string;
}

export interface DemoCase {
  id: string;
  name: string;
  scenario: string;
  question: string;
  draft: string;
  docs: SourceDoc[];
  context: Record<string, string>;
  purpose: string;
  expected: { rerank: string; verify: string; compare: string };
}

export const CASES: DemoCase[] = [
  {
    id: "supported",
    name: "Fully supported",
    scenario: "Draft reply matches both policy documents.",
    question:
      "Acme Retail is evaluating your platform. How long does Northwind retain customer audit logs, and what happens at the end of the retention period?",
    draft:
      "Northwind retains customer audit logs for 12 months from the date of record. At the end of the retention period, audit logs are automatically and permanently deleted from all production and backup systems.",
    docs: [
      {
        id: "doc-sp21",
        title: "Security Policy v2.1",
        text: `## Access to customer data
Access to customer data requires role-based permissions assigned by the account owner. Permission sets are reviewed quarterly by the Northwind security team.

## Audit log retention
Northwind retains customer audit logs for 12 months from the date of record. At the end of the retention period, audit logs are automatically and permanently deleted from all production and backup systems.

## Incident response
Suspected security incidents must be reported to security@northwind.example within 24 hours of detection. The on-call security lead triages all reports.`,
      },
      {
        id: "doc-dhs13",
        title: "Data Handling Standard v1.3",
        text: `## Data in transit
Customer data in transit is protected with TLS 1.3 or higher on all public interfaces.

## Retention of audit records
Audit log records are retained for 12 months, then purged automatically. During the retention period, access to audit logs is restricted to the Northwind security team.

## Backup archives
Full backup archives are retained for 7 years to support disaster recovery and legal holds.`,
      },
    ],
    context: {
      customer: "Acme Retail Ltd",
      plan: "Northwind Cloud Platform, Standard plan",
      region: "EU (eu-west-1)",
      deployment: "Multi-tenant SaaS",
    },
    purpose:
      "Baseline case: the draft is grounded in both sources. Demonstrates the ready-for-review state with every claim carrying evidence.",
    expected: {
      rerank: "Audit-retention passages rank as use; unrelated sections (backups, incident response) are skipped with reasons.",
      verify: "Both claims supported by these documents, with evidence quotes and offsets.",
      compare: "Documents relate (both cover audit-log retention) with no conflicting pair.",
    },
  },
  {
    id: "conflict",
    name: "True conflict",
    scenario: "Two policy documents disagree on the same retention period.",
    question:
      "Acme Retail is evaluating your platform. How long does Northwind retain customer audit logs, and what happens at the end of the retention period?",
    draft:
      "Northwind retains customer audit logs for 12 months from the date of record. At the end of the retention period, audit logs are automatically and permanently deleted from all production and backup systems.",
    docs: [
      {
        id: "doc-sp21",
        title: "Security Policy v2.1",
        text: `## Access to customer data
Access to customer data requires role-based permissions assigned by the account owner. Permission sets are reviewed quarterly by the Northwind security team.

## Audit log retention
Northwind retains customer audit logs for 12 months from the date of record. At the end of the retention period, audit logs are automatically and permanently deleted from all production and backup systems.

## Incident response
Suspected security incidents must be reported to security@northwind.example within 24 hours of detection. The on-call security lead triages all reports.`,
      },
      {
        id: "doc-rs26",
        title: "Retention Schedule 2026",
        text: `## Audit records
Audit log records are retained for 24 months from the date of record, then deleted. This schedule applies to all Northwind production systems and supersedes earlier schedules.

## Customer account records
Customer account records are retained for the life of the account plus 3 years.`,
      },
    ],
    context: {
      customer: "Acme Retail Ltd",
      plan: "Northwind Cloud Platform, Standard plan",
      region: "EU (eu-west-1)",
      deployment: "Multi-tenant SaaS",
    },
    purpose:
      "Conflict case: the same subject (audit-log retention), same scope (all production systems) carries two different numbers. Approval must be blocked until a human decides.",
    expected: {
      rerank: "Both audit-retention passages rank as use; the account-records section is skipped.",
      verify: "The 12-month claim is contradicted by at least one source; evidence points to both passages.",
      compare: "The audit-records pair is flagged conflicting with paired passages from both documents.",
    },
  },
  {
    id: "missing",
    name: "Missing evidence",
    scenario: "Draft claims at-rest encryption and ISO 27001; no source states either.",
    question:
      "Is customer data encrypted at rest, and does Northwind hold ISO 27001 certification?",
    draft:
      "All customer data is encrypted at rest using AES-256. Northwind holds ISO 27001 certification and undergoes an annual external audit.",
    docs: [
      {
        id: "doc-sp21",
        title: "Security Policy v2.1",
        text: `## Access to customer data
Access to customer data requires role-based permissions assigned by the account owner. Permission sets are reviewed quarterly by the Northwind security team.

## Audit log retention
Northwind retains customer audit logs for 12 months from the date of record. At the end of the retention period, audit logs are automatically and permanently deleted from all production and backup systems.

## Incident response
Suspected security incidents must be reported to security@northwind.example within 24 hours of detection. The on-call security lead triages all reports.`,
      },
      {
        id: "doc-dhs13",
        title: "Data Handling Standard v1.3",
        text: `## Data in transit
Customer data in transit is protected with TLS 1.3 or higher on all public interfaces.

## Retention of audit records
Audit log records are retained for 12 months, then purged automatically. During the retention period, access to audit logs is restricted to the Northwind security team.

## Backup archives
Full backup archives are retained for 7 years to support disaster recovery and legal holds.`,
      },
    ],
    context: {
      customer: "Acme Retail Ltd",
      plan: "Northwind Cloud Platform, Standard plan",
      region: "EU (eu-west-1)",
      deployment: "Multi-tenant SaaS",
    },
    purpose:
      "Missing-evidence case: neither at-rest encryption nor ISO 27001 appears anywhere in the sources. The claims must surface as not established, never as false, and TLS-in-transit must not be read as at-rest.",
    expected: {
      rerank: "Transit-encryption passages may rank as the closest available, or be skipped as not answering.",
      verify: "Both claims not_stated: no source establishes them. The TLS 1.3 passage is about transport, not at-rest.",
      compare: "Documents relate on retention; no conflicting pair.",
    },
  },
  {
    id: "scope-trap",
    name: "Different-scope numbers",
    scenario: "12 months for audit logs, 7 years for backups: different subjects, not a conflict.",
    question: "How long do you retain audit logs and backup archives?",
    draft:
      "Audit logs are retained for 12 months. Backup archives are retained for 7 years to support disaster recovery and legal holds.",
    docs: [
      {
        id: "doc-sp21",
        title: "Security Policy v2.1",
        text: `## Access to customer data
Access to customer data requires role-based permissions assigned by the account owner. Permission sets are reviewed quarterly by the Northwind security team.

## Audit log retention
Northwind retains customer audit logs for 12 months from the date of record. At the end of the retention period, audit logs are automatically and permanently deleted from all production and backup systems.

## Incident response
Suspected security incidents must be reported to security@northwind.example within 24 hours of detection. The on-call security lead triages all reports.`,
      },
      {
        id: "doc-brs20",
        title: "Backup and Recovery Standard v2.0",
        text: `## Backup retention
Full backup archives are retained for 7 years. Incremental backups are retained for 35 days. Backup archives support disaster recovery and legal holds.

## Backup encryption
Backup archives are encrypted at rest with AES-256.

## Restoration testing
Restoration from backup is tested quarterly, and results are recorded in the risk register.`,
      },
    ],
    context: {
      customer: "Acme Retail Ltd",
      plan: "Northwind Cloud Platform, Standard plan",
      region: "EU (eu-west-1)",
      deployment: "Multi-tenant SaaS",
    },
    purpose:
      "Trap case for Compare: differing numbers over different scopes (audit logs versus backup archives) should not be flagged as conflicting. If Compare does flag it, the conflict card routes to human resolution, which is the designed fallback either way. The observed outcome is recorded in the test log, never hardcoded.",
    expected: {
      rerank: "Audit-retention and backup-retention passages rank as use for their respective parts of the question.",
      verify: "Both claims supported by these documents.",
      compare: "Desired: no conflicting pair, because the differing numbers describe different data types. Fallback: if flagged, the pair routes to human resolution.",
    },
  },
  {
    id: "wrong-question",
    name: "Accurate but off-topic",
    scenario:
      "Every claim is supported by the sources, but the draft does not answer the customer's question.",
    question:
      "Acme Retail is evaluating your platform. How long does Northwind retain customer audit logs, and what happens at the end of the retention period?",
    draft:
      "Access to customer data requires role-based permissions assigned by the account owner, and permission sets are reviewed quarterly by the Northwind security team. Customer data in transit is protected with TLS 1.3 or higher on all public interfaces.",
    docs: [
      {
        id: "doc-sp21",
        title: "Security Policy v2.1",
        text: `## Access to customer data
Access to customer data requires role-based permissions assigned by the account owner. Permission sets are reviewed quarterly by the Northwind security team.

## Audit log retention
Northwind retains customer audit logs for 12 months from the date of record. At the end of the retention period, audit logs are automatically and permanently deleted from all production and backup systems.

## Incident response
Suspected security incidents must be reported to security@northwind.example within 24 hours of detection. The on-call security lead triages all reports.`,
      },
      {
        id: "doc-dhs13",
        title: "Data Handling Standard v1.3",
        text: `## Data in transit
Customer data in transit is protected with TLS 1.3 or higher on all public interfaces.

## Retention of audit records
Audit log records are retained for 12 months, then purged automatically. During the retention period, access to audit logs is restricted to the Northwind security team.

## Backup archives
Full backup archives are retained for 7 years to support disaster recovery and legal holds.`,
      },
    ],
    context: {
      customer: "Acme Retail Ltd",
      plan: "Northwind Cloud Platform, Standard plan",
      region: "EU (eu-west-1)",
      deployment: "Multi-tenant SaaS",
    },
    purpose:
      "Relevance gate: grounding and answers_question are separate Verify signals. Every claim here is supported by the documents — nothing is contradicted, nothing is missing — yet the draft talks about access permissions and transport encryption while the customer asked about audit-log retention. It must never read as ready for review; Verify's answers_question score routes it to a human.",
    expected: {
      rerank: "Retention passages rank as use for the question even though the draft never mentions retention.",
      verify: "Both claims supported by these documents; answers_question low — the draft does not address the question.",
      compare: "Documents relate on retention; no conflicting pair, so the review state comes from the relevance gate, not from a conflict.",
    },
  },
];

export function getCase(id: string): DemoCase | undefined {
  return CASES.find((c) => c.id === id);
}
