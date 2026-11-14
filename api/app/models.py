# generated from openapi.yaml, do not edit

from __future__ import annotations

from datetime import date as date_aliased
from enum import StrEnum
from typing import Any

from pydantic import AwareDatetime, BaseModel, Field, RootModel


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
    retired_reason: str | None
    pinned: bool | None = Field(
        False, description='True when a person marked this fact as binding.'
    )


class FactPage(BaseModel):
    items: list[Fact]
    total: int
    limit: int
    offset: int


class Document(BaseModel):
    id: str = Field(..., examples=['07-documents/report-final'])
    title: str
    date: date_aliased
    path: str
    text: str | None = Field(
        None, description='Full text, only on GET /documents/{doc_id}.'
    )


class Citation(BaseModel):
    doc_id: str
    quote: str


class Topic(BaseModel):
    id: str = Field(..., examples=['onboarding-target'])
    label: str = Field(..., examples=['Onboarding target'])
    fact_ids: list[str]


class TopicChain(BaseModel):
    topic: Topic
    facts: list[Fact] = Field(..., description='Oldest to newest.')


class AskRequest(BaseModel):
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


class Models(BaseModel):
    extraction: str
    classification: str
    answer: str


class Config(BaseModel):
    models: Models
    cost_cap_usd: float = Field(..., ge=0.0)
    active_corpus: str
    stale_after_days: int = Field(..., ge=1)
    low_confidence_threshold: float = Field(..., ge=0.0, le=1.0)


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


class AuditEvent(BaseModel):
    id: str
    at: AwareDatetime
    actor: str = Field(
        ..., description='User name, or `system` for ingest and classify.'
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
    id: str = Field(..., examples=['C-001'])
    topic: str
    status: Status2
    summary: str
    facts: list[Fact]
    detected_at: AwareDatetime
    resolution: ConflictResolution | None


class ExportBundle(BaseModel):
    version: str = Field(..., examples=['0.1.0'])
    exported_at: AwareDatetime
    corpus: str
    documents: list[Document] = Field(..., description='Including text.')
    topics: list[Topic]
    facts: list[Fact]
    audit: list[AuditEvent]
    answers: list[AnswerRecord]
