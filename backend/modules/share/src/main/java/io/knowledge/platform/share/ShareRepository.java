package io.knowledge.platform.share;

import static org.jooq.impl.DSL.field;
import static org.jooq.impl.DSL.name;
import static org.jooq.impl.DSL.table;

import io.knowledge.platform.authorization.ResourceNotFoundException;
import io.knowledge.platform.common.Ids;
import java.time.OffsetDateTime;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.jooq.DSLContext;
import org.jooq.JSONB;
import org.jooq.Record;
import org.jooq.Table;
import org.springframework.stereotype.Repository;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

@Repository
class ShareRepository {

    private static final Table<Record> SHARES = table(name("shares"));
    private final DSLContext dsl;
    private final ObjectMapper mapper;

    ShareRepository(DSLContext dsl, ObjectMapper mapper) {
        this.dsl = dsl;
        this.mapper = mapper;
    }

    void insert(ShareRecord share) {
        dsl.insertInto(SHARES)
                .columns(
                        uuid("id"),
                        uuid("workspace_id"),
                        string("resource_type"),
                        uuid("resource_id"),
                        string("share_type"),
                        string("token_hash"),
                        string("password_hash"),
                        string("role"),
                        bool("require_approval"),
                        time("expires_at"),
                        bool("allow_copy"),
                        bool("allow_download"),
                        bool("allow_export"),
                        bool("allow_comment"),
                        bool("allow_search_index"),
                        number("policy_version"),
                        uuid("created_by"),
                        time("created_at"),
                        time("updated_at"))
                .values(
                        share.id(),
                        share.workspaceId(),
                        share.resourceType(),
                        share.resourceId(),
                        share.shareType(),
                        share.tokenHash(),
                        share.passwordHash(),
                        share.role(),
                        share.requireApproval(),
                        share.expiresAt(),
                        share.allowCopy(),
                        share.allowDownload(),
                        share.allowExport(),
                        share.allowComment(),
                        share.allowSearchIndex(),
                        share.policyVersion(),
                        share.createdBy(),
                        share.createdAt(),
                        share.updatedAt())
                .execute();
    }

    void insertQuickNoteSnapshot(
            UUID shareId, UUID quickNoteId, UUID ownerId, OffsetDateTime now) {
        int changed = dsl.execute(
                "insert into quick_note_share_snapshots"
                        + "(share_id,quick_note_id,source_revision,content_json,plain_text,captured_at) "
                        + "select ?::uuid,id,revision_no,content_json,plain_text,?::timestamptz "
                        + "from quick_notes where id=?::uuid and user_id=?::uuid and deleted_at is null",
                shareId, now, quickNoteId, ownerId);
        if (changed != 1) throw new ResourceNotFoundException();
    }

    QuickNoteShareView quickNoteShare(UUID shareId) {
        org.jooq.Field<UUID> quickNoteId = uuid("s", "quick_note_id");
        org.jooq.Field<Long> sourceRevision = number("s", "source_revision");
        org.jooq.Field<JSONB> content = field(name("s", "content_json"), JSONB.class);
        org.jooq.Field<String> plainText = string("s", "plain_text");
        org.jooq.Field<OffsetDateTime> capturedAt = time("s", "captured_at");
        Record record = dsl.select(
                        quickNoteId,
                        sourceRevision,
                        content,
                        plainText,
                        capturedAt)
                .from(table(name("quick_note_share_snapshots")).as("s"))
                .join(table(name("quick_notes")).as("q"))
                .on(uuid("q", "id").eq(uuid("s", "quick_note_id")))
                .where(uuid("s", "share_id").eq(shareId).and(time("q", "deleted_at").isNull()))
                .fetchOne();
        if (record == null) throw new ResourceNotFoundException();
        return new QuickNoteShareView(
                record.get(quickNoteId), record.get(sourceRevision), json(record.get(content)),
                record.get(plainText), record.get(capturedAt));
    }

    ShareRecord findActiveByTokenHash(String tokenHash) {
        return select().and(string("token_hash").eq(tokenHash)).fetchOne(ShareRepository::map);
    }

    ReaderConfig readerConfig(String resourceType, UUID resourceId) {
        Record record = "KNOWLEDGE_BASE".equals(resourceType)
                ? dsl.select(
                                field(name("appearance_config"), JSONB.class),
                                field(name("watermark_config"), JSONB.class))
                        .from(table(name("knowledge_bases")))
                        .where(uuid("id").eq(resourceId).and(time("archived_at").isNull()))
                        .fetchOne()
                : dsl.select(
                                field(name("kb", "appearance_config"), JSONB.class),
                                field(name("kb", "watermark_config"), JSONB.class))
                        .from(table(name("pages")).as("p"))
                        .join(table(name("knowledge_bases")).as("kb"))
                        .on(field(name("kb", "id"), UUID.class)
                                .eq(field(name("p", "knowledge_base_id"), UUID.class)))
                        .where(field(name("p", "id"), UUID.class).eq(resourceId))
                        .fetchOne();
        if (record == null) return new ReaderConfig(mapper.createObjectNode(), mapper.createObjectNode());
        return new ReaderConfig(
                json(record.get(0, JSONB.class)),
                json(record.get(1, JSONB.class)));
    }

    KnowledgeBaseShareView knowledgeBaseShare(UUID knowledgeBaseId, UUID requestedPageId) {
        Record knowledgeBase = dsl.fetchOne(
                "select id,name,slug,description,icon,homepage_page_id,catalog_revision,"
                        + "appearance_config,watermark_config,catalog_config "
                        + "from knowledge_bases where id=?::uuid and archived_at is null",
                knowledgeBaseId);
        if (knowledgeBase == null) throw new ResourceNotFoundException();

        List<KnowledgeBaseSharePageView> pages = dsl.fetch(
                        "select p.id page_id,pub.id publication_id,pub.title_snapshot title,p.path,"
                                + "pub.content_type,pub.metadata_snapshot->>'icon' icon,pub.published_at "
                                + "from pages p join knowledge_bases kb on kb.id=p.knowledge_base_id "
                                + "join page_publications pub on pub.id=p.published_revision_id "
                                + "where p.knowledge_base_id=?::uuid and p.deleted_at is null "
                                + "and p.visibility_override in ('INHERIT','PUBLIC') "
                                + "and (p.id=kb.homepage_page_id or exists(select 1 from catalog_nodes node "
                                + "where node.knowledge_base_id=p.knowledge_base_id and node.page_id=p.id "
                                + "and node.node_type='DOCUMENT' and node.deleted_at is null)) "
                                + "and pub.superseded_at is null order by pub.published_at desc,p.id",
                        knowledgeBaseId)
                .map(record -> new KnowledgeBaseSharePageView(
                        record.get("page_id", UUID.class),
                        record.get("publication_id", UUID.class),
                        record.get("title", String.class),
                        record.get("path", String.class),
                        record.get("content_type", String.class),
                        record.get("icon", String.class),
                        record.get("published_at", OffsetDateTime.class)));
        Set<UUID> readablePageIds = new HashSet<>(
                pages.stream().map(KnowledgeBaseSharePageView::pageId).toList());
        List<KnowledgeBaseShareNodeView> catalog = dsl.fetch(
                        "select id,node_type,page_id,parent_id,position,title_override,url "
                                + "from catalog_nodes where knowledge_base_id=?::uuid and deleted_at is null "
                                + "order by parent_id nulls first,position,id",
                        knowledgeBaseId)
                .map(record -> new KnowledgeBaseShareNodeView(
                        record.get("id", UUID.class),
                        record.get("node_type", String.class),
                        record.get("page_id", UUID.class),
                        record.get("parent_id", UUID.class),
                        record.get("position", String.class),
                        record.get("title_override", String.class),
                        record.get("url", String.class)))
                .stream()
                .filter(node -> !"DOCUMENT".equals(node.nodeType())
                        || readablePageIds.contains(node.pageId()))
                .toList();

        UUID homepagePageId = knowledgeBase.get("homepage_page_id", UUID.class);
        UUID selectedPageId = requestedPageId != null && readablePageIds.contains(requestedPageId)
                ? requestedPageId
                : readablePageIds.contains(homepagePageId)
                        ? homepagePageId
                        : catalog.stream()
                                .filter(node -> "DOCUMENT".equals(node.nodeType()))
                                .map(KnowledgeBaseShareNodeView::pageId)
                                .findFirst()
                                .orElseGet(() -> pages.isEmpty() ? null : pages.getFirst().pageId());
        return new KnowledgeBaseShareView(
                knowledgeBase.get("id", UUID.class),
                knowledgeBase.get("name", String.class),
                knowledgeBase.get("slug", String.class),
                knowledgeBase.get("description", String.class),
                knowledgeBase.get("icon", String.class),
                homepagePageId,
                knowledgeBase.get("catalog_revision", Long.class),
                json(knowledgeBase.get("appearance_config", JSONB.class)),
                json(knowledgeBase.get("watermark_config", JSONB.class)),
                json(knowledgeBase.get("catalog_config", JSONB.class)),
                catalog,
                pages,
                selectedPageId);
    }

    boolean knowledgeBasePageReadable(UUID knowledgeBaseId, UUID pageId) {
        return dsl.fetchExists(dsl.selectOne()
                .from(table(name("pages")).as("p"))
                .join(table(name("page_publications")).as("pub"))
                .on(field(name("pub", "id"), UUID.class)
                        .eq(field(name("p", "published_revision_id"), UUID.class)))
                .where(field(name("p", "id"), UUID.class).eq(pageId)
                        .and(field(name("p", "knowledge_base_id"), UUID.class).eq(knowledgeBaseId))
                        .and(field(name("p", "deleted_at"), OffsetDateTime.class).isNull())
                        .and(field(name("p", "visibility_override"), String.class)
                                .in("INHERIT", "PUBLIC"))
                        .and(field(name("pub", "superseded_at"), OffsetDateTime.class).isNull())));
    }

    boolean inviteAccepted(ShareRecord share, UUID userId) {
        if (userId == null) return false;
        if ("KNOWLEDGE_BASE".equals(share.resourceType())) {
            String current = dsl.select(string("role"))
                    .from(table(name("knowledge_base_members")))
                    .where(uuid("knowledge_base_id").eq(share.resourceId())
                            .and(uuid("user_id").eq(userId)))
                    .fetchOne(string("role"));
            return roleRank(current) >= roleRank(memberRole(share.role()));
        }
        Record acl = dsl.select(string("role"), field(name("capabilities"), JSONB.class))
                .from(table(name("acl_entries")))
                .where(string("resource_type").eq("PAGE")
                        .and(uuid("resource_id").eq(share.resourceId()))
                        .and(string("subject_type").eq("USER"))
                        .and(uuid("subject_id").eq(userId))
                        .and(time("deleted_at").isNull()))
                .fetchOne();
        if (acl == null) return false;
        String role = acl.get(string("role"));
        if ("EDITOR".equals(share.role())) return roleRank(role) >= roleRank("EDITOR");
        if (roleRank(role) >= roleRank("READER")) return true;
        JsonNode capabilities = json(acl.get(field(name("capabilities"), JSONB.class)));
        return capabilities.isArray()
                && java.util.stream.StreamSupport.stream(capabilities.spliterator(), false)
                        .map(JsonNode::stringValue)
                        .anyMatch(value -> "COMMENTER".equals(share.role())
                                ? "COMMENT".equals(value)
                                : "READ".equals(value));
    }

    void ensureWorkspaceMembership(
            UUID workspaceId, UUID userId, String requestedRole, OffsetDateTime now) {
        String current = dsl.select(string("role"))
                .from(table(name("workspace_memberships")))
                .where(uuid("workspace_id").eq(workspaceId).and(uuid("user_id").eq(userId)))
                .fetchOne(string("role"));
        if (current == null) {
            dsl.insertInto(table(name("workspace_memberships")))
                    .columns(uuid("workspace_id"), uuid("user_id"), string("role"), time("created_at"))
                    .values(workspaceId, userId, requestedRole, now)
                    .execute();
        } else if ("EXTERNAL".equals(current) && "MEMBER".equals(requestedRole)) {
            dsl.update(table(name("workspace_memberships")))
                    .set(string("role"), "MEMBER")
                    .where(uuid("workspace_id").eq(workspaceId).and(uuid("user_id").eq(userId)))
                    .execute();
        }
    }

    void acceptKnowledgeBaseInvite(
            UUID knowledgeBaseId, UUID userId, String requestedRole, OffsetDateTime now) {
        String current = dsl.select(string("role"))
                .from(table(name("knowledge_base_members")))
                .where(uuid("knowledge_base_id").eq(knowledgeBaseId)
                        .and(uuid("user_id").eq(userId)))
                .fetchOne(string("role"));
        String role = roleRank(current) >= roleRank(requestedRole) ? current : requestedRole;
        dsl.insertInto(table(name("knowledge_base_members")))
                .columns(uuid("knowledge_base_id"), uuid("user_id"), string("role"),
                        time("created_at"), time("updated_at"))
                .values(knowledgeBaseId, userId, role, now, now)
                .onConflict(uuid("knowledge_base_id"), uuid("user_id"))
                .doUpdate()
                .set(string("role"), role)
                .set(time("updated_at"), now)
                .execute();
    }

    UUID pageKnowledgeBaseId(UUID pageId) {
        return dsl.select(uuid("knowledge_base_id"))
                .from(table(name("pages")))
                .where(uuid("id").eq(pageId).and(time("deleted_at").isNull()))
                .fetchOne(uuid("knowledge_base_id"));
    }

    private static String memberRole(String shareRole) {
        return "EDITOR".equals(shareRole) ? "EDITOR" : "READER";
    }

    private static int roleRank(String role) {
        if (role == null) return 0;
        return switch (role) {
            case "READER", "VIEWER" -> 1;
            case "EDITOR", "MEMBER" -> 2;
            case "MANAGER", "ADMIN", "OWNER" -> 3;
            default -> 0;
        };
    }

    String userEmail(UUID userId) {
        if (userId == null) return null;
        return dsl.select(string("email_original"))
                .from(table(name("users")))
                .where(uuid("id").eq(userId))
                .fetchOne(string("email_original"));
    }

    private JsonNode json(JSONB value) {
        return value == null ? mapper.createObjectNode() : mapper.readTree(value.data());
    }

    ShareRecord findForUpdate(UUID shareId) {
        return select().and(uuid("id").eq(shareId)).forUpdate().fetchOne(ShareRepository::map);
    }

    List<ShareView> listForResource(String resourceType, UUID resourceId) {
        return select()
                .and(string("resource_type")
                        .eq(resourceType)
                        .and(uuid("resource_id").eq(resourceId))
                        .and(time("revoked_at").isNull()))
                .orderBy(time("created_at").desc())
                .fetch(record -> view(map(record)));
    }

    void update(ShareRecord share) {
        int changed = dsl.update(SHARES)
                .set(string("password_hash"), share.passwordHash())
                .set(string("role"), share.role())
                .set(bool("require_approval"), share.requireApproval())
                .set(time("expires_at"), share.expiresAt())
                .set(bool("allow_copy"), share.allowCopy())
                .set(bool("allow_download"), share.allowDownload())
                .set(bool("allow_export"), share.allowExport())
                .set(bool("allow_comment"), share.allowComment())
                .set(bool("allow_search_index"), share.allowSearchIndex())
                .set(number("policy_version"), share.policyVersion())
                .set(time("updated_at"), share.updatedAt())
                .where(uuid("id").eq(share.id()).and(time("revoked_at").isNull()))
                .execute();
        requireChanged(changed);
    }

    void replaceToken(
            UUID shareId,
            String tokenHash,
            long policyVersion,
            OffsetDateTime now) {
        int changed = dsl.update(SHARES)
                .set(string("token_hash"), tokenHash)
                .set(number("policy_version"), policyVersion)
                .set(time("updated_at"), now)
                .where(uuid("id").eq(shareId).and(time("revoked_at").isNull()))
                .execute();
        requireChanged(changed);
        dsl.deleteFrom(table(name("share_access_sessions")))
                .where(uuid("share_id").eq(shareId))
                .execute();
    }

    void revoke(UUID shareId, OffsetDateTime now) {
        int changed = dsl.update(SHARES)
                .set(time("revoked_at"), now)
                .set(number("policy_version"), number("policy_version").plus(1L))
                .set(time("updated_at"), now)
                .where(uuid("id").eq(shareId).and(time("revoked_at").isNull()))
                .execute();
        requireChanged(changed);
        dsl.deleteFrom(table(name("share_access_sessions")))
                .where(uuid("share_id").eq(shareId))
                .execute();
    }

    void archiveWorkspace(UUID workspaceId, OffsetDateTime now) {
        dsl.update(SHARES)
                .set(time("revoked_at"), now)
                .set(number("policy_version"), number("policy_version").plus(1L))
                .set(time("updated_at"), now)
                .where(uuid("workspace_id").eq(workspaceId)
                        .and(time("revoked_at").isNull()))
                .execute();
        dsl.execute(
                "delete from share_access_sessions where share_id in "
                        + "(select id from shares where workspace_id = ?::uuid)",
                workspaceId);
    }

    void insertAccessSession(
            UUID shareId,
            String tokenHash,
            OffsetDateTime expiresAt,
            OffsetDateTime now) {
        dsl.insertInto(table(name("share_access_sessions")))
                .columns(
                        uuid("id"),
                        uuid("share_id"),
                        string("token_hash"),
                        time("expires_at"),
                        time("created_at"))
                .values(Ids.next(), shareId, tokenHash, expiresAt, now)
                .execute();
    }

    boolean validAccessSession(UUID shareId, String tokenHash, OffsetDateTime now) {
        return dsl.fetchExists(dsl.selectOne()
                .from(table(name("share_access_sessions")))
                .where(uuid("share_id")
                        .eq(shareId)
                        .and(string("token_hash").eq(tokenHash))
                        .and(time("expires_at").gt(now))));
    }

    int recentPasswordFailures(
            UUID shareId,
            String visitorHash,
            OffsetDateTime since) {
        return dsl.fetchCount(
                table(name("share_visits")),
                uuid("share_id")
                        .eq(shareId)
                        .and(string("visitor_hash").eq(visitorHash))
                        .and(string("result").eq("PASSWORD_FAILED"))
                        .and(time("created_at").ge(since)));
    }

    void visit(
            UUID shareId,
            String visitorHash,
            UUID authenticatedUserId,
            String result,
            OffsetDateTime now) {
        dsl.insertInto(table(name("share_visits")))
                .columns(
                        uuid("id"),
                        uuid("share_id"),
                        string("visitor_hash"),
                        uuid("authenticated_user_id"),
                        string("result"),
                        time("created_at"))
                .values(Ids.next(), shareId, visitorHash, authenticatedUserId, result, now)
                .execute();
    }

    String approvalStatus(
            UUID shareId,
            UUID requesterId,
            long policyVersion) {
        return dsl.select(string("status"))
                .from(table(name("share_access_requests")))
                .where(uuid("share_id")
                        .eq(shareId)
                        .and(uuid("requester_id").eq(requesterId))
                        .and(number("policy_version").eq(policyVersion)))
                .fetchOne(string("status"));
    }

    ShareAccessRequestView requestAccess(
            UUID shareId,
            UUID requesterId,
            long policyVersion,
            String message,
            OffsetDateTime now) {
        dsl.insertInto(table(name("share_access_requests")))
                .columns(
                        uuid("id"),
                        uuid("share_id"),
                        uuid("requester_id"),
                        number("policy_version"),
                        string("message"),
                        string("status"),
                        time("created_at"),
                        time("updated_at"))
                .values(
                        Ids.next(), shareId, requesterId, policyVersion, message,
                        "PENDING", now, now)
                .onConflict(uuid("share_id"), uuid("requester_id"))
                .doUpdate()
                .set(number("policy_version"), policyVersion)
                .set(string("message"), message)
                .set(string("status"), "PENDING")
                .set(uuid("reviewed_by"), (UUID) null)
                .set(time("reviewed_at"), (OffsetDateTime) null)
                .set(time("updated_at"), now)
                .execute();
        return findRequest(shareId, requesterId);
    }

    List<ShareAccessRequestView> accessRequests(UUID shareId) {
        return requestSelect()
                .where(requestUuid("share_id").eq(shareId))
                .orderBy(requestTime("updated_at").desc())
                .fetch(ShareRepository::mapRequest);
    }

    AccessRequestRecord accessRequestForUpdate(UUID requestId) {
        return dsl.select(
                        requestUuid("id"),
                        requestUuid("share_id"),
                        requestUuid("requester_id"),
                        requestNumber("policy_version"),
                        requestString("status"))
                .from(table(name("share_access_requests")).as("r"))
                .where(requestUuid("id").eq(requestId))
                .forUpdate()
                .fetchOne(record -> new AccessRequestRecord(
                        record.value1(), record.value2(), record.value3(),
                        record.value4(), record.value5()));
    }

    ShareAccessRequestView reviewAccessRequest(
            UUID requestId,
            UUID reviewerId,
            String status,
            OffsetDateTime now) {
        int changed = dsl.update(table(name("share_access_requests")))
                .set(string("status"), status)
                .set(uuid("reviewed_by"), reviewerId)
                .set(time("reviewed_at"), now)
                .set(time("updated_at"), now)
                .where(uuid("id").eq(requestId).and(string("status").eq("PENDING")))
                .execute();
        requireChanged(changed);
        return findRequest(requestId);
    }

    private ShareAccessRequestView findRequest(UUID requestId) {
        return requestSelect()
                .where(requestUuid("id").eq(requestId))
                .fetchOne(ShareRepository::mapRequest);
    }

    private ShareAccessRequestView findRequest(UUID shareId, UUID requesterId) {
        return requestSelect()
                .where(requestUuid("share_id")
                        .eq(shareId)
                        .and(requestUuid("requester_id").eq(requesterId)))
                .fetchOne(ShareRepository::mapRequest);
    }

    private org.jooq.SelectJoinStep<? extends Record> requestSelect() {
        return dsl.select(
                        requestUuid("id"),
                        requestUuid("share_id"),
                        requestUuid("requester_id"),
                        field(name("u", "email_original"), String.class),
                        field(name("u", "display_name"), String.class),
                        requestNumber("policy_version"),
                        requestString("message"),
                        requestString("status"),
                        requestUuid("reviewed_by"),
                        requestTime("reviewed_at"),
                        requestTime("created_at"),
                        requestTime("updated_at"))
                .from(table(name("share_access_requests")).as("r"))
                .join(table(name("users")).as("u"))
                .on(field(name("u", "id"), UUID.class).eq(requestUuid("requester_id")));
    }

    private static ShareAccessRequestView mapRequest(Record record) {
        return new ShareAccessRequestView(
                record.get(requestUuid("id")),
                record.get(requestUuid("share_id")),
                record.get(requestUuid("requester_id")),
                record.get(field(name("u", "email_original"), String.class)),
                record.get(field(name("u", "display_name"), String.class)),
                record.get(requestNumber("policy_version")),
                record.get(requestString("message")),
                record.get(requestString("status")),
                record.get(requestUuid("reviewed_by")),
                record.get(requestTime("reviewed_at")),
                record.get(requestTime("created_at")),
                record.get(requestTime("updated_at")));
    }

    private org.jooq.SelectConditionStep<? extends Record> select() {
        return dsl.select(
                        uuid("id"),
                        uuid("workspace_id"),
                        string("resource_type"),
                        uuid("resource_id"),
                        string("share_type"),
                        string("token_hash"),
                        string("password_hash"),
                        string("role"),
                        bool("require_approval"),
                        time("expires_at"),
                        bool("allow_copy"),
                        bool("allow_download"),
                        bool("allow_export"),
                        bool("allow_comment"),
                        bool("allow_search_index"),
                        number("policy_version"),
                        uuid("created_by"),
                        time("revoked_at"),
                        time("created_at"),
                        time("updated_at"))
                .from(SHARES)
                .where(uuid("id").isNotNull());
    }

    private static ShareRecord map(Record record) {
        return new ShareRecord(
                record.get(uuid("id")),
                record.get(uuid("workspace_id")),
                record.get(string("resource_type")),
                record.get(uuid("resource_id")),
                record.get(string("share_type")),
                record.get(string("token_hash")),
                record.get(string("password_hash")),
                record.get(string("role")),
                Boolean.TRUE.equals(record.get(bool("require_approval"))),
                record.get(time("expires_at")),
                Boolean.TRUE.equals(record.get(bool("allow_copy"))),
                Boolean.TRUE.equals(record.get(bool("allow_download"))),
                Boolean.TRUE.equals(record.get(bool("allow_export"))),
                Boolean.TRUE.equals(record.get(bool("allow_comment"))),
                Boolean.TRUE.equals(record.get(bool("allow_search_index"))),
                record.get(number("policy_version")),
                record.get(uuid("created_by")),
                record.get(time("revoked_at")),
                record.get(time("created_at")),
                record.get(time("updated_at")));
    }

    static ShareView view(ShareRecord share) {
        return new ShareView(
                share.id(),
                share.workspaceId(),
                share.resourceType(),
                share.resourceId(),
                share.shareType(),
                share.passwordHash() != null,
                share.role(),
                share.requireApproval(),
                share.expiresAt(),
                share.allowCopy(),
                share.allowDownload(),
                share.allowExport(),
                share.allowComment(),
                share.allowSearchIndex(),
                share.policyVersion(),
                share.createdBy(),
                share.revokedAt(),
                share.createdAt(),
                share.updatedAt());
    }

    record ReaderConfig(JsonNode appearanceConfig, JsonNode watermarkConfig) {}

    private static org.jooq.Field<UUID> uuid(String value) {
        return field(name(value), UUID.class);
    }

    private static org.jooq.Field<UUID> uuid(String qualifier, String value) {
        return field(name(qualifier, value), UUID.class);
    }

    private static org.jooq.Field<String> string(String value) {
        return field(name(value), String.class);
    }

    private static org.jooq.Field<String> string(String qualifier, String value) {
        return field(name(qualifier, value), String.class);
    }

    private static org.jooq.Field<Boolean> bool(String value) {
        return field(name(value), Boolean.class);
    }

    private static org.jooq.Field<Long> number(String value) {
        return field(name(value), Long.class);
    }

    private static org.jooq.Field<Long> number(String qualifier, String value) {
        return field(name(qualifier, value), Long.class);
    }

    private static org.jooq.Field<OffsetDateTime> time(String value) {
        return field(name(value), OffsetDateTime.class);
    }

    private static org.jooq.Field<OffsetDateTime> time(String qualifier, String value) {
        return field(name(qualifier, value), OffsetDateTime.class);
    }

    private static org.jooq.Field<UUID> requestUuid(String value) {
        return field(name("r", value), UUID.class);
    }

    private static org.jooq.Field<String> requestString(String value) {
        return field(name("r", value), String.class);
    }

    private static org.jooq.Field<Long> requestNumber(String value) {
        return field(name("r", value), Long.class);
    }

    private static org.jooq.Field<OffsetDateTime> requestTime(String value) {
        return field(name("r", value), OffsetDateTime.class);
    }

    private static void requireChanged(int changed) {
        if (changed != 1) {
            throw new ResourceNotFoundException();
        }
    }

    record ShareRecord(
            UUID id,
            UUID workspaceId,
            String resourceType,
            UUID resourceId,
            String shareType,
            String tokenHash,
            String passwordHash,
            String role,
            boolean requireApproval,
            OffsetDateTime expiresAt,
            boolean allowCopy,
            boolean allowDownload,
            boolean allowExport,
            boolean allowComment,
            boolean allowSearchIndex,
            long policyVersion,
            UUID createdBy,
            OffsetDateTime revokedAt,
            OffsetDateTime createdAt,
            OffsetDateTime updatedAt) {}

    record AccessRequestRecord(
            UUID id,
            UUID shareId,
            UUID requesterId,
            long policyVersion,
            String status) {}
}
