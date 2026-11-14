# generated from openapi.yaml, do not edit

from __future__ import annotations

from datetime import date as date_aliased
from enum import Enum, StrEnum
from typing import Any

from pydantic import AnyUrl, AwareDatetime, BaseModel, ConfigDict, Field, RootModel


class FactType(StrEnum):
    DECISION = 'DECISION'
    CONSTRAINT = 'CONSTRAINT'
    EVIDENCE = 'EVIDENCE'
    HYPOTHESIS = 'HYPOTHESIS'
    SUPERSEDED = 'SUPERSEDED'
    OPEN = 'OPEN'


class FactStatus(StrEnum):
    active = 'active'
    retired = 'retired'


class Fact(BaseModel):
    project_id: str | None = Field(
        None, description='Owning project. Null or absent means organisation scope.'
    )
    id: str = Field(..., examples=['M-106'])
    topic: str = Field(..., description='Topic id.', examples=['onboarding-target'])
    value: str = Field(..., examples=['Onboarding SLA: 3–4 weeks'])
    type: FactType
    status: FactStatus
    doc_id: str = Field(..., examples=['07-documents/report-final'])
    quote: str = Field(..., description='Verbatim source quote.')
    date: date_aliased = Field(..., examples=['2025-11-28'])
    supersedes: str | None = Field(
        ..., description='Id of the older fact this one replaces.'
    )
    superseded_by: str | None = Field(
        ..., description='Id of the newer fact that replaces this one.'
    )
    confidence: float = Field(..., examples=[0.94], ge=0.0, le=1.0)
    retired_by: str | None = Field(
        None,
        description='Member name or id of who retired the fact.',
        examples=['Giulia'],
    )
    retired_at: AwareDatetime | None = Field(
        None,
        description='When the fact was retired.',
        examples=['2026-11-14T15:20:00Z'],
    )
    retired_reason: str | None
    pinned: bool | None = Field(
        False, description='True when a person marked this fact as binding.'
    )


class FactPage(BaseModel):
    items: list[Fact]
    total: int
    limit: int
    offset: int


class SourceType(Enum):
    documents = 'documents'
    document_library = 'document_library'
    github = 'github'
    mail = 'mail'
    NoneType_None = None


class Document(BaseModel):
    project_id: str | None = Field(
        None, description='Owning project. Null or absent means organisation scope.'
    )
    source_id: str | None = None
    version: int | None = Field(1, ge=1)
    version_of: str | None = Field(
        None, description='Id of the document this one is a new version of.'
    )
    id: str = Field(..., examples=['07-documents/report-final'])
    title: str
    date: date_aliased
    path: str
    text: str | None = Field(
        None, description='Full text, only on GET /documents/{doc_id}.'
    )
    current_version: int | None = Field(
        None, description="Latest version number of the document's version chain."
    )
    source_type: SourceType | None = None


class Citation(BaseModel):
    doc_id: str
    quote: str


class Topic(BaseModel):
    project_id: str | None = Field(
        None, description='Owning project. Null or absent means organisation scope.'
    )
    id: str = Field(..., examples=['onboarding-target'])
    label: str = Field(..., examples=['Onboarding target'])
    fact_ids: list[str]


class TopicChain(BaseModel):
    topic: Topic
    facts: list[Fact] = Field(..., description='Oldest to newest.')


class AskRequest(BaseModel):
    project_id: str | None = Field(
        None,
        description='Restrict the answer to one project. Absence of project_id means organisation scope (all projects).',
    )
    question: str = Field(..., min_length=1)
    topic: str | None = Field(
        None, description='Optional topic id to scope the answer.'
    )
    include_plain_retrieval: bool | None = False


class PlainRetrieval(BaseModel):
    doc_id: str
    quote: str
    rank: int = Field(..., ge=1)


class Status(StrEnum):
    binding = 'binding'
    contested = 'contested'
    no_answer = 'no_answer'


class AskResponse(BaseModel):
    question: str
    status: Status
    answer: str = Field(..., description='Plain-language sentence.')
    binding: Fact | None
    superseded: list[Fact]
    conflicts: list[Fact] = Field(
        ...,
        description='Contested values. For status contested these are the competing facts.',
    )
    citations: list[Citation]
    plain_retrieval: PlainRetrieval | None = Field(
        None, description='Present only when include_plain_retrieval is true.'
    )
    changed_because: str | None = Field(..., examples=['you retired requirement R1.1'])


class RetireRequest(BaseModel):
    reason: str = Field(..., min_length=1)
    actor: str = Field(..., min_length=1)


class RestoreRequest(BaseModel):
    actor: str | None = 'anonymous'
    reason: str | None = None


class IngestRequest(BaseModel):
    corpus: str | None = 'org-consulting-clearpath'
    force: bool | None = False


class Status1(StrEnum):
    queued = 'queued'
    running = 'running'
    done = 'done'
    error = 'error'


class Kind(StrEnum):
    ingest = 'ingest'
    classify = 'classify'


class IngestJob(BaseModel):
    id: str
    status: Status1
    docs: int = Field(..., ge=0)
    facts: int = Field(..., ge=0)
    cost_usd: float = Field(..., ge=0.0)
    kind: Kind | None = 'ingest'


class Metrics(BaseModel):
    ndcg_at_10_plain: float = Field(..., ge=0.0, le=1.0)
    ndcg_at_10_canonico: float = Field(..., ge=0.0, le=1.0)
    binding_accuracy_plain: float = Field(..., ge=0.0, le=1.0)
    binding_accuracy_canonico: float = Field(..., ge=0.0, le=1.0)


class PerQueryItem(BaseModel):
    query_id: str = Field(..., examples=['q01'])
    text: str
    tests: str = Field(..., description='What the query tests')
    plain_top_doc: str
    canonico_top_doc: str
    gold_doc: str
    pass_plain: bool
    pass_canonico: bool


class EvalResult(BaseModel):
    corpus: str
    metrics: Metrics
    per_query: list[PerQueryItem]
    measured_at: AwareDatetime


class Error(BaseModel):
    code: str = Field(
        ...,
        description='Machine code: bad_request, not_found, validation_error, internal_error.',
    )
    message: str


class FactCreate(BaseModel):
    topic: str
    value: str
    type: FactType
    doc_id: str | None = Field(
        None, description='Source document, null for a fact typed in by a person.'
    )
    quote: str
    date: date_aliased
    confidence: float | None = Field(1, ge=0.0, le=1.0)
    actor: str


class FactPatch(BaseModel):
    value: str | None = None
    type: FactType | None = None
    topic: str | None = None
    reason: str = Field(..., min_length=1)
    actor: str = Field(..., min_length=1)


class PinRequest(BaseModel):
    reason: str = Field(..., min_length=1)
    actor: str = Field(..., min_length=1)


class SupersedeRequest(BaseModel):
    by_fact_id: str = Field(
        ..., description='The newer fact that replaces the one in the path.'
    )
    reason: str = Field(..., min_length=1)
    actor: str = Field(..., min_length=1)


class Changes(BaseModel):
    from_: Any | None = Field(None, alias='from')
    to: Any | None = None


class Status2(StrEnum):
    open = 'open'
    resolved = 'resolved'


class ConflictResolution(BaseModel):
    winning_fact_id: str
    reason: str = Field(..., min_length=1)
    actor: str = Field(..., min_length=1)
    resolved_at: AwareDatetime | None = None


class Status3(StrEnum):
    open = 'open'
    closed = 'closed'


class OpenQuestion(BaseModel):
    id: str = Field(..., examples=['OQ-001'])
    topic: str
    question: str
    fact_id: str = Field(..., description='The OPEN fact.')
    doc_id: str
    status: Status3
    opened_at: date_aliased
    closed_at: date_aliased | None
    answer_fact_id: str | None
    note: str | None


class OpenQuestionClose1(BaseModel):
    answer_fact_id: str
    note: str | None = None
    actor: str = Field(..., min_length=1)


class OpenQuestionClose2(BaseModel):
    answer_fact_id: str | None = None
    note: str
    actor: str = Field(..., min_length=1)


class OpenQuestionClose(RootModel[OpenQuestionClose1 | OpenQuestionClose2]):
    root: OpenQuestionClose1 | OpenQuestionClose2


class MaintenanceReason(StrEnum):
    superseded_still_retrievable = 'superseded_still_retrievable'
    stale = 'stale'
    low_confidence = 'low_confidence'


class ProposedAction(StrEnum):
    retire = 'retire'


class Status4(StrEnum):
    pending = 'pending'
    approved = 'approved'
    dismissed = 'dismissed'


class MaintenanceItem(BaseModel):
    id: str = Field(..., examples=['MQ-001'])
    fact: Fact
    reason: MaintenanceReason
    detail: str
    proposed_action: ProposedAction
    status: Status4
    proposed_at: AwareDatetime


class MaintenanceDecision(BaseModel):
    actor: str = Field(..., min_length=1)
    note: str | None = None


class TopicCreate(BaseModel):
    id: str | None = Field(
        None, description='Optional slug. Generated from the label when omitted.'
    )
    label: str = Field(..., min_length=1)


class TopicPatch(BaseModel):
    label: str = Field(..., min_length=1)


class TopicMergeRequest(BaseModel):
    into_topic_id: str
    actor: str = Field(..., min_length=1)


class Format(StrEnum):
    text = 'text'
    markdown = 'markdown'


class DocumentCreate(BaseModel):
    id: str | None = Field(
        None, description='Optional. Generated from the title when omitted.'
    )
    title: str
    date: date_aliased
    format: Format | None = 'markdown'
    text: str
    ingest: bool | None = True


class DocumentUpload(BaseModel):
    file: str = Field(
        ...,
        description='Text, markdown or PDF file.',
        json_schema_extra={
            'contentEncoding': 'base64',
            'contentMediaType': 'application/octet-stream',
        },
    )
    title: str
    date: date_aliased
    ingest: bool | None = True


class DocumentCreated(BaseModel):
    document: Document
    ingest_job: IngestJob | None


class DocumentDeleted(BaseModel):
    doc_id: str
    deleted_fact_ids: list[str]
    audit_event_id: str


class Kind1(StrEnum):
    fact = 'fact'
    document = 'document'


class SearchResult(BaseModel):
    kind: Kind1
    id: str
    score: float
    snippet: str
    doc_id: str
    topic: str | None
    type: FactType | None


class SearchResponse(BaseModel):
    query: str
    total: int
    results: list[SearchResult]


class Method(StrEnum):
    bm25 = 'bm25'
    embedding = 'embedding'


class PlainRetrievalRequest(BaseModel):
    query: str = Field(..., min_length=1)
    top_k: int | None = Field(10, ge=1, le=50)
    method: Method | None = 'bm25'


class Result(BaseModel):
    rank: int = Field(..., ge=1)
    doc_id: str
    score: float
    quote: str


class PlainRetrievalResult(BaseModel):
    query: str
    method: Method
    results: list[Result]


class Status5(StrEnum):
    binding = 'binding'
    contested = 'contested'
    no_answer = 'no_answer'


class AnswerSummary(BaseModel):
    id: str = Field(..., examples=['ans-0007'])
    question: str
    asked_at: AwareDatetime
    status: Status5


class AnswerRecord(BaseModel):
    id: str
    asked_at: AwareDatetime
    memory_version: int = Field(
        ..., description='Counter incremented by every memory change.'
    )
    request: AskRequest
    response: AskResponse
    fact_snapshot: list[Fact] = Field(
        ..., description='Facts as they were when the answer was given.'
    )


class Diff(BaseModel):
    field: str = Field(
        ...,
        description='AskResponse field name: status, answer, binding, superseded, conflicts, citations.',
    )
    before: Any
    after: Any


class ReplayDiff(BaseModel):
    answer_id: str
    new_answer_id: str
    changed: bool
    changed_because: str | None
    diffs: list[Diff]


class UndoRequest(BaseModel):
    actor: str = Field(..., min_length=1)
    reason: str = Field(..., min_length=1)


class ClassifyRequest1(BaseModel):
    doc_id: str
    fact_ids: list[str] | None = Field(None, min_length=1)
    force: bool


class ClassifyRequest2(BaseModel):
    doc_id: str | None = None
    fact_ids: list[str] = Field(..., min_length=1)
    force: bool


class ClassifyRequest(RootModel[ClassifyRequest1 | ClassifyRequest2]):
    root: ClassifyRequest1 | ClassifyRequest2


class Status6(StrEnum):
    queued = 'queued'
    running = 'running'
    done = 'done'
    error = 'error'


class EvalRun(BaseModel):
    id: str = Field(..., examples=['eval-19c2'])
    status: Status6
    started_at: AwareDatetime
    finished_at: AwareDatetime | None
    cost_usd: float
    result: EvalResult | None


class GoldDoc(BaseModel):
    doc_id: str
    grade: int = Field(..., ge=0, le=3)


class EvalQuery(BaseModel):
    query_id: str = Field(..., examples=['q01'])
    text: str
    tests: str
    gold_docs: list[GoldDoc]


class Cost(BaseModel):
    spent_usd: float
    cap_usd: float


class NeedsAttention(BaseModel):
    stale_active: int | None = Field(
        None, description='Superseded facts that are still active.'
    )
    conflicts_open: int | None = None
    open_questions: int | None = None


class Answers(BaseModel):
    binding: int | None = None
    contested: int | None = None
    no_answer: int | None = None
    since: AwareDatetime | None = None


class Action(StrEnum):
    retire = 'retire'
    restore = 'restore'
    new_version = 'new_version'
    inbound_email = 'inbound_email'
    resolve = 'resolve'
    ingest = 'ingest'


class RecentChange(BaseModel):
    at: AwareDatetime | None = None
    actor: str | None = None
    action: Action | None = None
    fact_id: str | None = None
    summary: str | None = None


class TimeToFixSeconds(BaseModel):
    median: float | None = None
    samples: int | None = None
    measured_at: AwareDatetime | None = None


class GithubPreviewRequest(BaseModel):
    repo_url: str


class GithubPreview(BaseModel):
    repo_url: str
    full_name: str
    public: bool
    description: str | None
    default_branch: str
    open_issues: int
    has_readme: bool
    last_pushed_at: AwareDatetime | None


class StatsSource(BaseModel):
    source_id: str | None = None
    type: str | None = None
    label: str | None = None
    status: str | None = None
    last_synced_at: AwareDatetime | None = None


class Models(BaseModel):
    extraction: str
    classification: str
    answer: str


class Provider(StrEnum):
    anthropic = 'anthropic'
    gateway = 'gateway'


class Config(BaseModel):
    models: Models
    cost_cap_usd: float = Field(..., ge=0.0)
    active_corpus: str
    stale_after_days: int = Field(..., ge=1)
    low_confidence_threshold: float = Field(..., ge=0.0, le=1.0)
    offline_mode: bool | None = Field(
        False,
        description='When true, answers and demo actions use cached or deterministic results and make no live LLM calls.',
    )
    provider: Provider | None = None


class Models1(BaseModel):
    extraction: str | None = None
    classification: str | None = None
    answer: str | None = None


class ConfigPatch(BaseModel):
    models: Models1 | None = None
    cost_cap_usd: float | None = Field(None, ge=0.0)
    active_corpus: str | None = None
    stale_after_days: int | None = Field(None, ge=1)
    low_confidence_threshold: float | None = Field(None, ge=0.0, le=1.0)
    offline_mode: bool | None = Field(
        False,
        description='When true, answers and demo actions use cached or deterministic results and make no live LLM calls.',
    )
    provider: Provider | None = None


class AuditAction(StrEnum):
    retire = 'retire'
    restore = 'restore'
    ingest = 'ingest'
    classify = 'classify'
    create = 'create'
    patch = 'patch'
    pin = 'pin'
    unpin = 'unpin'
    supersede = 'supersede'
    unlink = 'unlink'
    resolve = 'resolve'
    close = 'close'
    approve = 'approve'
    dismiss = 'dismiss'
    merge = 'merge'
    delete_document = 'delete_document'
    undo = 'undo'
    import_ = 'import'
    reset = 'reset'


class MailMode(StrEnum):
    imap_mock = 'imap_mock'
    webhook = 'webhook'


class MailConfig(BaseModel):
    mode: MailMode
    imap_host: str | None = None
    imap_user: str | None = None
    inbound_address: str | None = Field(
        None, description='Address the webhook provider forwards to.'
    )
    poll_interval_s: int | None = Field(60, ge=5)


class MailConfigWrite(BaseModel):
    mode: MailMode
    imap_host: str | None = None
    imap_user: str | None = None
    password: str | None = None
    inbound_address: str | None = None
    poll_interval_s: int | None = Field(60, ge=5)


class Organisation(BaseModel):
    id: str
    name: str
    mail_config: MailConfig | None = None


class OrganisationPatch(BaseModel):
    name: str | None = Field(None, min_length=1)


class Project(BaseModel):
    id: str
    name: str
    description: str | None = None
    created_at: AwareDatetime
    mail_config_override: MailConfig | None = None
    effective_mail_config: MailConfig | None = Field(
        None, description='The override when set, otherwise the organisation config.'
    )
    source_ids: list[str] | None = None


class ProjectCreate(BaseModel):
    id: str | None = Field(
        None,
        description='Optional slug. Generated when absent. 409 if it already exists.',
    )
    name: str = Field(..., min_length=1)
    description: str | None = None
    mail_config_override: MailConfigWrite | None = None


class ProjectPatch(BaseModel):
    name: str | None = Field(None, min_length=1)
    description: str | None = None


class ProjectPage(BaseModel):
    items: list[Project]
    total: int
    limit: int
    offset: int


class ProjectMail(BaseModel):
    project_id: str
    overridden: bool = Field(
        ...,
        description='True when the project has its own config, false when it inherits the organisation one.',
    )
    effective_mail_config: MailConfig
    mail_config_override: MailConfig | None = None


class SourceType1(StrEnum):
    documents = 'documents'
    document_library = 'document_library'
    github = 'github'
    mail = 'mail'


class SourceStatus(StrEnum):
    idle = 'idle'
    syncing = 'syncing'
    ok = 'ok'
    error = 'error'


class IncludeEnum(StrEnum):
    issues = 'issues'
    readme = 'readme'
    discussions = 'discussions'
    pulls = 'pulls'


class GithubSourceConfig(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    repo_url: AnyUrl = Field(..., description='Public repository only, no keys.')
    include: list[IncludeEnum] | None = None


class MailSourceConfig(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    mode: MailMode
    mailbox: str
    match_rules: list[str] | None = Field(
        None, description='MailRule ids that route into this source.'
    )


class Provider2(StrEnum):
    local_mock = 'local_mock'
    sharepoint = 'sharepoint'
    google_drive = 'google_drive'


class DocumentLibraryConfig(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    provider: Provider2 = Field(
        ...,
        description='Only `local_mock` is implemented. `sharepoint` and `google_drive` are out of scope for the MVP.',
    )
    root_path: str


class DocumentsSourceConfig(RootModel[dict[str, Any]]):
    root: dict[str, Any] = Field(..., max_length=0)


class SourceConfig(
    RootModel[
        GithubSourceConfig
        | MailSourceConfig
        | DocumentLibraryConfig
        | DocumentsSourceConfig
    ]
):
    root: (
        GithubSourceConfig
        | MailSourceConfig
        | DocumentLibraryConfig
        | DocumentsSourceConfig
    ) = Field(..., description='Shape depends on the source `type`.')


class Source(BaseModel):
    id: str
    project_id: str
    type: SourceType1
    label: str
    status: SourceStatus
    last_synced_at: AwareDatetime | None = None
    items: int | None = Field(
        None,
        description='Number of items (documents, issues, messages) ingested from this source.',
    )
    config: SourceConfig | None = None


class SourceCreate(BaseModel):
    type: SourceType1
    label: str
    config: SourceConfig | None = None


class SourcePatch(BaseModel):
    label: str | None = None
    config: SourceConfig | None = None


class SyncJob(BaseModel):
    id: str
    source_id: str
    status: Status6
    items_added: int | None = None
    facts_created: int | None = None
    cost_usd: float | None = None
    started_at: AwareDatetime | None = None
    finished_at: AwareDatetime | None = None


class MailMatchType(StrEnum):
    sender_domain = 'sender_domain'
    sender_address = 'sender_address'
    recipient = 'recipient'
    subject_contains = 'subject_contains'


class MailRule(BaseModel):
    id: str
    match_type: MailMatchType
    value: str
    project_id: str
    priority: int = Field(
        ..., description='Lower number wins when several rules match.'
    )


class MailRuleCreate(BaseModel):
    match_type: MailMatchType
    value: str
    project_id: str
    priority: int | None = 100


class MailRulePatch(BaseModel):
    match_type: MailMatchType | None = None
    value: str | None = None
    project_id: str | None = None
    priority: int | None = None


class EmailAttachment(BaseModel):
    filename: str
    content_type: str | None = None
    text: str = Field(..., description='Extracted text of the attachment.')


class InboundEmail(BaseModel):
    message_id: str
    from_: str = Field(..., alias='from')
    to: list[str]
    cc: list[str] | None = None
    subject: str
    date: AwareDatetime
    text: str
    html: str | None = None
    thread_id: str | None = None
    attachments: list[EmailAttachment] | None = None


class SupersedeLink(BaseModel):
    fact_id: str = Field(..., description='The new fact.')
    supersedes: str = Field(..., description='The older fact it replaces.')


class InboundEmailResult(BaseModel):
    message_id: str
    routed_project_id: str | None = Field(
        None,
        description='Null when no rule matched, the email is then stored at organisation scope.',
    )
    rule_id: str | None = None
    document_id: str
    facts_created: list[str]
    supersedes_created: list[SupersedeLink]
    audit_event_id: str | None = None


class RuleTestResult(BaseModel):
    matched: bool
    routed_project_id: str | None = None
    rule_id: str | None = None
    reason: str | None = None


class MailPollRequest(BaseModel):
    project_id: str | None = Field(
        None,
        description='Poll this project mailbox. Absent or null polls the organisation mailbox.',
    )


class MailPollResult(BaseModel):
    polled: int = Field(
        ..., description='Number of messages fetched from the mocked inbox.'
    )
    results: list[InboundEmailResult]


class ReceivedMessage(BaseModel):
    message_id: str
    project_id: str | None = None
    from_: str = Field(..., alias='from')
    subject: str
    date: AwareDatetime
    rule_id: str | None = None
    document_id: str | None = None


class MessagePage(BaseModel):
    items: list[ReceivedMessage]
    total: int
    limit: int
    offset: int


class DocumentVersion(BaseModel):
    document_id: str
    version: int = Field(..., ge=1)
    version_label: str | None = None
    uploaded_at: AwareDatetime | None = None
    supersedes_document_id: str | None = None
    facts_superseded: list[str] | None = Field(
        None,
        description='Ids of facts of the previous version that this version superseded.',
    )


class DocumentVersionCreate(BaseModel):
    version_label: str | None = None
    title: str | None = None
    date: date_aliased | None = None
    text: str


class DocumentVersionResult(BaseModel):
    version: DocumentVersion
    facts_created: list[str]
    supersedes_created: list[SupersedeLink]


class Role(StrEnum):
    owner = 'owner'
    admin = 'admin'
    editor = 'editor'
    viewer = 'viewer'


class Permission(StrEnum):
    ask = 'ask'
    read_facts = 'read_facts'
    retire_fact = 'retire_fact'
    restore_fact = 'restore_fact'
    correct_fact = 'correct_fact'
    resolve_conflict = 'resolve_conflict'
    manage_sources = 'manage_sources'
    manage_mail = 'manage_mail'
    manage_members = 'manage_members'
    admin_demo = 'admin_demo'


class MemberStatus(StrEnum):
    active = 'active'
    invited = 'invited'


class Member(BaseModel):
    id: str
    name: str
    email: str
    org_role: Role
    created_at: AwareDatetime
    status: MemberStatus


class MemberCreate(BaseModel):
    name: str = Field(..., min_length=1)
    email: str
    org_role: Role


class MemberPatch(BaseModel):
    name: str | None = Field(None, min_length=1)
    email: str | None = None
    org_role: Role | None = None


class MemberPage(BaseModel):
    total: int
    items: list[Member]


class ProjectMember(BaseModel):
    member_id: str
    project_id: str
    role: Role
    inherited: bool = Field(
        ...,
        description='True when the role comes from the organisation role, false when set explicitly on the project.',
    )


class ProjectMemberSet(BaseModel):
    member_id: str = Field(..., description='Must match the member_id in the path.')
    role: Role


class RolePermissions(BaseModel):
    role: Role
    permissions: list[Permission]


class Me(BaseModel):
    member: Member
    role: Role
    permissions: list[Permission]


class FirstAdmin(BaseModel):
    name: str = Field(..., min_length=1)
    email: str


class OrgSetupRequest(BaseModel):
    organisation_name: str = Field(..., min_length=1)
    primary_email_domain: str = Field(..., min_length=1)
    mail_config: MailConfigWrite | None = None
    first_admin: FirstAdmin


class SetupStepState(StrEnum):
    done = 'done'
    pending = 'pending'


class Steps(BaseModel):
    org: SetupStepState
    mail: SetupStepState
    first_project: SetupStepState
    first_source: SetupStepState


class SetupStatus(BaseModel):
    completed: bool
    steps: Steps


class AuditEvent(BaseModel):
    project_id: str | None = Field(
        None, description='Owning project. Null or absent means organisation scope.'
    )
    id: str
    at: AwareDatetime
    actor: str = Field(
        ..., description='User name, or `system` for ingest and classify.'
    )
    actor_role: Role | None = Field(
        None, description='Role of the actor when the event was written. Optional.'
    )
    action: AuditAction
    fact_id: str | None = Field(..., description='Null for ingest events.')
    reason: str | None


class FactVersion(BaseModel):
    version: int = Field(..., ge=1)
    at: AwareDatetime
    actor: str
    action: AuditAction
    changes: dict[str, Changes] = Field(
        ..., description='Map of field name to {from, to}.'
    )
    snapshot: Fact


class Dependents(BaseModel):
    fact_id: str
    facts: list[Fact]
    conflicts: list[str] = Field(..., description='Conflict ids.')
    answers: list[AnswerSummary]


class Conflict(BaseModel):
    project_id: str | None = Field(
        None, description='Owning project. Null or absent means organisation scope.'
    )
    id: str = Field(..., examples=['C-001'])
    topic: str
    status: Status2
    summary: str
    facts: list[Fact]
    detected_at: AwareDatetime
    resolution: ConflictResolution | None


class Stats(BaseModel):
    documents: int
    topics: int
    facts_total: int
    by_type: dict[str, int] = Field(..., description='Count per FactType.')
    by_status: dict[str, int] = Field(..., description='Count per FactStatus.')
    open_conflicts: int
    open_questions: int
    maintenance_pending: int
    cost: Cost
    last_ingest_at: AwareDatetime | None
    last_reset_at: AwareDatetime | None = Field(
        None, description='When the demo was last reset. Null if never.'
    )
    needs_attention: NeedsAttention | None = Field(
        None, description='Counts of items needing attention, for a dashboard.'
    )
    facts_by_type: dict[str, int] | None = Field(
        None, description='Count per FactType.'
    )
    facts_by_status: dict[str, int] | None = Field(
        None, description='Count per FactStatus.'
    )
    answers: Answers | None = None
    sources: list[StatsSource] | None = None
    recent_changes: list[RecentChange] | None = Field(None, max_length=10)
    time_to_fix_seconds: TimeToFixSeconds | None = None


class ExportBundle(BaseModel):
    version: str = Field(..., examples=['0.1.0'])
    exported_at: AwareDatetime
    corpus: str
    documents: list[Document] = Field(..., description='Including text.')
    topics: list[Topic]
    facts: list[Fact]
    audit: list[AuditEvent]
    answers: list[AnswerRecord]
