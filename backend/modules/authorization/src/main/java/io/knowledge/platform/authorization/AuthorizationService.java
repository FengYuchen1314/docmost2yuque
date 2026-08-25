package io.knowledge.platform.authorization;

import static org.jooq.impl.DSL.field;
import static org.jooq.impl.DSL.name;
import static org.jooq.impl.DSL.table;

import io.knowledge.platform.audit.AuditService;
import io.knowledge.platform.common.Ids;
import java.time.Clock;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.EnumSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import org.jooq.DSLContext;
import org.jooq.JSONB;
import org.jooq.Record;
import org.jooq.Table;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.ObjectMapper;

@Service
public class AuthorizationService {

    private static final Table<Record> ACL = table(name("acl_entries"));
    private static final Set<Capability> ALL = Set.copyOf(EnumSet.allOf(Capability.class));
    private static final Set<Capability> CONTENT_EDITOR = Set.of(
            Capability.READ,
            Capability.EDIT,
            Capability.COMMENT,
            Capability.PUBLISH,
            Capability.COPY,
            Capability.DOWNLOAD,
            Capability.EXPORT);
    private static final Set<Capability> CONTENT_READER =
            Set.of(Capability.READ, Capability.COMMENT, Capability.COPY);

    private final DSLContext dsl;
    private final ObjectMapper objectMapper;
    private final AuditService auditService;
    private final Clock clock;

    public AuthorizationService(
            DSLContext dsl,
            ObjectMapper objectMapper,
            AuditService auditService,
            Clock clock) {
        this.dsl = dsl;
        this.objectMapper = objectMapper;
        this.auditService = auditService;
        this.clock = clock;
    }

    @Transactional(readOnly = true)
    public AuthorizationDecision resolve(
            UUID actorId,
            ResourceType resourceType,
            UUID resourceId) {
        if (resourceType == null || resourceId == null) {
            throw new IllegalArgumentException("Resource type and id are required");
        }
        ResourceInfo resource = findResource(resourceType, resourceId);
        if (resource == null) {
            throw new ResourceNotFoundException();
        }
        if (!dsl.fetchExists(dsl.selectOne()
                .from(table(name("workspaces")))
                .where(field(name("id"), UUID.class).eq(resource.workspaceId())
                        .and(field(name("deleted_at"), OffsetDateTime.class).isNull())))) {
            throw new ResourceNotFoundException();
        }

        List<String> sources = new ArrayList<>();
        String workspaceRole = actorId == null
                ? null
                : dsl.select(field(name("role"), String.class))
                        .from(table(name("workspace_memberships")))
                        .where(field(name("workspace_id"), UUID.class)
                                .eq(resource.workspaceId())
                                .and(field(name("user_id"), UUID.class).eq(actorId)))
                        .fetchOne(field(name("role"), String.class));

        EnumSet<Capability> capabilities = EnumSet.noneOf(Capability.class);
        Set<Capability> tenantCeiling = tenantCeiling(workspaceRole);
        if (workspaceRole != null) {
            sources.add("workspace:" + workspaceRole.toLowerCase(Locale.ROOT));
        }

        if (resourceType == ResourceType.WORKSPACE) {
            capabilities.addAll(workspaceRoleCapabilities(workspaceRole));
        } else if (resourceType == ResourceType.QUICK_NOTE) {
            // Quick notes are personal even inside an organization. Workspace administrators
            // must not inherit access to another user's private capture.
            applyResourceInheritance(actorId, resource, capabilities, sources);
        } else if (workspaceRole != null) {
            if (Set.of("OWNER", "ADMIN").contains(workspaceRole)) {
                capabilities.addAll(ALL);
            }
            applyResourceInheritance(actorId, resource, capabilities, sources);
        }

        if (resourceType != ResourceType.QUICK_NOTE) {
            applyAcl(actorId, resource, tenantCeiling, capabilities, sources);
        }
        capabilities.retainAll(tenantCeiling);

        return new AuthorizationDecision(
                resource.workspaceId(),
                resourceType,
                resourceId,
                Set.copyOf(capabilities),
                resource.visibility(),
                permissionVersion(resource.workspaceId()),
                List.copyOf(sources));
    }

    @Transactional(readOnly = true)
    public AuthorizationDecision require(
            UUID actorId,
            ResourceType resourceType,
            UUID resourceId,
            Capability capability) {
        AuthorizationDecision decision = resolve(actorId, resourceType, resourceId);
        if (!decision.allows(capability)) {
            throw new AuthorizationDeniedException();
        }
        return decision;
    }

    @Transactional
    public AclEntryView grant(UUID actorId, UpsertAclCommand command) {
        validateCommand(command);
        AuthorizationDecision decision = require(
                actorId,
                command.resourceType(),
                command.resourceId(),
                Capability.MANAGE_PERMISSIONS);
        validateSubjectWorkspace(command, decision.workspaceId());
        OffsetDateTime now = OffsetDateTime.now(clock);
        dsl.fetch(
                "select pg_advisory_xact_lock(hashtextextended(?, 0))",
                command.resourceType() + ":" + command.resourceId());
        softDeleteMatching(command, now);

        UUID id = Ids.next();
        JSONB capabilities = JSONB.valueOf(objectMapper.writeValueAsString(
                command.capabilities().stream().map(Enum::name).sorted().toList()));
        dsl.insertInto(ACL)
                .columns(
                        field(name("id"), UUID.class),
                        field(name("workspace_id"), UUID.class),
                        field(name("resource_type"), String.class),
                        field(name("resource_id"), UUID.class),
                        field(name("subject_type"), String.class),
                        field(name("subject_id"), UUID.class),
                        field(name("role"), String.class),
                        field(name("effect"), String.class),
                        field(name("capabilities"), JSONB.class),
                        field(name("created_by"), UUID.class),
                        field(name("created_at"), OffsetDateTime.class),
                        field(name("updated_at"), OffsetDateTime.class))
                .values(
                        id,
                        decision.workspaceId(),
                        command.resourceType().name(),
                        command.resourceId(),
                        command.subjectType().toUpperCase(Locale.ROOT),
                        command.subjectId(),
                        normalizeNullable(command.role()),
                        command.effect().toUpperCase(Locale.ROOT),
                        capabilities,
                        actorId,
                        now,
                        now)
                .execute();
        bumpPermissionVersion(decision.workspaceId(), now);
        auditService.success(
                decision.workspaceId(), actorId, "authorization.grant", "ACL_ENTRY", id);
        return new AclEntryView(
                id,
                decision.workspaceId(),
                command.resourceType(),
                command.resourceId(),
                command.subjectType().toUpperCase(Locale.ROOT),
                command.subjectId(),
                normalizeNullable(command.role()),
                command.effect().toUpperCase(Locale.ROOT),
                Set.copyOf(command.capabilities()),
                actorId,
                now,
                now);
    }

    @Transactional
    public void revoke(UUID actorId, UUID aclEntryId) {
        Record record = dsl.select(
                        field(name("workspace_id"), UUID.class),
                        field(name("resource_type"), String.class),
                        field(name("resource_id"), UUID.class))
                .from(ACL)
                .where(field(name("id"), UUID.class)
                        .eq(aclEntryId)
                        .and(field(name("deleted_at"), OffsetDateTime.class).isNull()))
                .forUpdate()
                .fetchOne();
        if (record == null) {
            throw new ResourceNotFoundException();
        }
        UUID workspaceId = record.get(field(name("workspace_id"), UUID.class));
        ResourceType resourceType = ResourceType.valueOf(
                record.get(field(name("resource_type"), String.class)));
        UUID resourceId = record.get(field(name("resource_id"), UUID.class));
        require(actorId, resourceType, resourceId, Capability.MANAGE_PERMISSIONS);
        OffsetDateTime now = OffsetDateTime.now(clock);
        dsl.update(ACL)
                .set(field(name("deleted_at"), OffsetDateTime.class), now)
                .set(field(name("updated_at"), OffsetDateTime.class), now)
                .where(field(name("id"), UUID.class).eq(aclEntryId))
                .execute();
        bumpPermissionVersion(workspaceId, now);
        auditService.success(
                workspaceId, actorId, "authorization.revoke", "ACL_ENTRY", aclEntryId);
    }

    @Transactional(readOnly = true)
    public List<AclEntryView> list(
            UUID actorId,
            ResourceType resourceType,
            UUID resourceId) {
        require(actorId, resourceType, resourceId, Capability.MANAGE_PERMISSIONS);
        return dsl.selectFrom(ACL)
                .where(field(name("resource_type"), String.class)
                        .eq(resourceType.name())
                        .and(field(name("resource_id"), UUID.class).eq(resourceId))
                        .and(field(name("deleted_at"), OffsetDateTime.class).isNull()))
                .orderBy(field(name("created_at")).asc())
                .fetch(this::mapAcl);
    }

    public long permissionVersion(UUID workspaceId) {
        Long version = dsl.select(field(name("version"), Long.class))
                .from(table(name("permission_versions")))
                .where(field(name("workspace_id"), UUID.class).eq(workspaceId))
                .fetchOne(field(name("version"), Long.class));
        return version == null ? 1L : version;
    }

    @Transactional
    public long invalidateWorkspace(UUID workspaceId) {
        return bumpPermissionVersion(workspaceId, OffsetDateTime.now(clock));
    }

    private void applyResourceInheritance(
            UUID actorId,
            ResourceInfo resource,
            EnumSet<Capability> capabilities,
            List<String> sources) {
        if (resource.type() == ResourceType.TEAM) {
            applyTeamRole(actorId, resource.id(), capabilities, sources);
            if ("WORKSPACE".equals(resource.visibility())) {
                capabilities.add(Capability.READ);
                sources.add("team:workspace-visible");
            }
            return;
        }
        if (resource.type() == ResourceType.QUICK_NOTE) {
            if (actorId != null && actorId.equals(resource.ownerId())) {
                capabilities.addAll(ALL);
                sources.add("quick-note:owner");
            }
            return;
        }

        ResourceInfo knowledgeBase = resource.type() == ResourceType.KNOWLEDGE_BASE
                ? resource
                : findKnowledgeBase(resource.knowledgeBaseId());
        if (knowledgeBase == null) {
            return;
        }
        if (actorId != null && actorId.equals(knowledgeBase.ownerId())
                && "PERSONAL".equals(knowledgeBase.ownerType())) {
            capabilities.addAll(ALL);
            sources.add("knowledge-base:personal-owner");
        }
        if (knowledgeBase.teamId() != null) {
            applyTeamRole(actorId, knowledgeBase.teamId(), capabilities, sources);
        }
        applyKnowledgeBaseMembership(actorId, knowledgeBase.id(), capabilities, sources);
        boolean privatePageOverride = resource.type() == ResourceType.PAGE
                && "PRIVATE".equals(resource.visibility());
        if ("WORKSPACE".equals(knowledgeBase.visibility()) && !privatePageOverride) {
            capabilities.add(Capability.READ);
            sources.add("knowledge-base:workspace-visible");
        }
        if (("PUBLIC".equals(knowledgeBase.visibility()) && !privatePageOverride)
                || "PUBLIC".equals(resource.visibility())) {
            capabilities.add(Capability.READ);
            sources.add("visibility:public");
        }
    }

    private void applyTeamRole(
            UUID actorId,
            UUID teamId,
            EnumSet<Capability> capabilities,
            List<String> sources) {
        if (actorId == null) {
            return;
        }
        String role = dsl.select(field(name("role"), String.class))
                .from(table(name("team_members")))
                .where(field(name("team_id"), UUID.class)
                        .eq(teamId)
                        .and(field(name("user_id"), UUID.class).eq(actorId)))
                .fetchOne(field(name("role"), String.class));
        if (role == null) {
            return;
        }
        if ("MANAGER".equals(role)) {
            capabilities.addAll(ALL);
        } else {
            capabilities.addAll(CONTENT_EDITOR);
        }
        sources.add("team:" + role.toLowerCase(Locale.ROOT));
    }

    private void applyKnowledgeBaseMembership(
            UUID actorId,
            UUID knowledgeBaseId,
            EnumSet<Capability> capabilities,
            List<String> sources) {
        if (actorId == null) {
            return;
        }
        String role = dsl.select(field(name("role"), String.class))
                .from(table(name("knowledge_base_members")))
                .where(field(name("knowledge_base_id"), UUID.class)
                        .eq(knowledgeBaseId)
                        .and(field(name("user_id"), UUID.class).eq(actorId)))
                .fetchOne(field(name("role"), String.class));
        if (role == null) {
            return;
        }
        capabilities.addAll(roleCapabilities(role));
        sources.add("knowledge-base:" + role.toLowerCase(Locale.ROOT));
    }

    private void applyAcl(
            UUID actorId,
            ResourceInfo resource,
            Set<Capability> tenantCeiling,
            EnumSet<Capability> capabilities,
            List<String> sources) {
        var matchingSubject = field(name("subject_type"), String.class).eq("PUBLIC");
        if (actorId != null) {
            var activeTeamMembership = org.jooq.impl.DSL.exists(dsl.selectOne()
                    .from(table(name("team_members")).as("acl_tm"))
                    .join(table(name("teams")).as("acl_t"))
                    .on(field(name("acl_t", "id"), UUID.class)
                            .eq(field(name("acl_tm", "team_id"), UUID.class)))
                    .join(table(name("workspace_memberships")).as("acl_wm"))
                    .on(field(name("acl_wm", "workspace_id"), UUID.class)
                            .eq(resource.workspaceId())
                            .and(field(name("acl_wm", "user_id"), UUID.class).eq(actorId)))
                    .where(field(name("acl_tm", "team_id"), UUID.class)
                            .eq(field(name("acl_entries", "subject_id"), UUID.class))
                            .and(field(name("acl_tm", "user_id"), UUID.class).eq(actorId))
                            .and(field(name("acl_t", "workspace_id"), UUID.class)
                                    .eq(resource.workspaceId()))
                            .and(field(name("acl_t", "deleted_at"), OffsetDateTime.class)
                                    .isNull())));
            var activeGroupMembership = org.jooq.impl.DSL.exists(dsl.selectOne()
                    .from(table(name("workspace_user_group_members")).as("acl_gm"))
                    .join(table(name("workspace_user_groups")).as("acl_g"))
                    .on(field(name("acl_g", "id"), UUID.class)
                            .eq(field(name("acl_gm", "group_id"), UUID.class)))
                    .join(table(name("workspace_memberships")).as("acl_wm"))
                    .on(field(name("acl_wm", "workspace_id"), UUID.class)
                            .eq(resource.workspaceId())
                            .and(field(name("acl_wm", "user_id"), UUID.class).eq(actorId)))
                    .where(field(name("acl_gm", "group_id"), UUID.class)
                            .eq(field(name("acl_entries", "subject_id"), UUID.class))
                            .and(field(name("acl_gm", "user_id"), UUID.class).eq(actorId))
                            .and(field(name("acl_g", "workspace_id"), UUID.class)
                                    .eq(resource.workspaceId()))
                            .and(field(name("acl_g", "deleted_at"), OffsetDateTime.class)
                                    .isNull())));
            matchingSubject = matchingSubject
                    .or(field(name("subject_type"), String.class)
                            .eq("USER")
                            .and(field(name("subject_id"), UUID.class).eq(actorId)))
                    .or(field(name("subject_type"), String.class)
                            .eq("TEAM")
                            .and(activeTeamMembership))
                    .or(field(name("subject_type"), String.class)
                            .eq("GROUP")
                            .and(activeGroupMembership));
        }
        List<Record> entries = dsl.selectFrom(ACL)
                .where(field(name("resource_type"), String.class)
                        .eq(resource.type().name())
                        .and(field(name("resource_id"), UUID.class).eq(resource.id()))
                        .and(field(name("deleted_at"), OffsetDateTime.class).isNull())
                        .and(matchingSubject))
                .fetch();

        for (Record entry : entries) {
            String effect = entry.get(field(name("effect"), String.class));
            Set<Capability> entryCapabilities = capabilities(entry);
            String role = entry.get(field(name("role"), String.class));
            if (role != null) {
                entryCapabilities = roleCapabilities(role);
            }
            if ("ALLOW".equals(effect)) {
                if ("USER".equals(entry.get(field(name("subject_type"), String.class)))
                        && role != null) {
                    capabilities.clear();
                }
                capabilities.addAll(entryCapabilities);
                capabilities.retainAll(tenantCeiling);
            } else {
                capabilities.removeAll(entryCapabilities.isEmpty() ? ALL : entryCapabilities);
            }
            sources.add("acl:" + effect.toLowerCase(Locale.ROOT));
        }
    }

    private ResourceInfo findResource(ResourceType type, UUID id) {
        return switch (type) {
            case WORKSPACE -> dsl.select(
                            field(name("id"), UUID.class),
                            field(name("default_visibility"), String.class))
                    .from(table(name("workspaces")))
                    .where(field(name("id"), UUID.class)
                            .eq(id)
                            .and(field(name("deleted_at"), OffsetDateTime.class).isNull()))
                    .fetchOne(record -> new ResourceInfo(
                            type,
                            id,
                            id,
                            record.value2(),
                            null,
                            null,
                            null,
                            null));
            case TEAM -> dsl.select(
                            field(name("workspace_id"), UUID.class),
                            field(name("visibility"), String.class))
                    .from(table(name("teams")))
                    .where(field(name("id"), UUID.class)
                            .eq(id)
                            .and(field(name("deleted_at"), OffsetDateTime.class).isNull()))
                    .fetchOne(record -> new ResourceInfo(
                            type,
                            id,
                            record.value1(),
                            record.value2(),
                            id,
                            null,
                            null,
                            null));
            case KNOWLEDGE_BASE -> findKnowledgeBase(id);
            case PAGE -> dsl.select(
                            field(name("workspace_id"), UUID.class),
                            field(name("knowledge_base_id"), UUID.class),
                            field(name("visibility_override"), String.class))
                    .from(table(name("pages")))
                    .where(field(name("id"), UUID.class)
                            .eq(id)
                            .and(field(name("deleted_at"), OffsetDateTime.class).isNull()))
                    .fetchOne(record -> new ResourceInfo(
                            type,
                            id,
                            record.value1(),
                            record.value3(),
                            null,
                            record.value2(),
                            null,
                            null));
            case QUICK_NOTE -> dsl.select(
                            field(name("workspace_id"), UUID.class),
                            field(name("user_id"), UUID.class))
                    .from(table(name("quick_notes")))
                    .where(field(name("id"), UUID.class)
                            .eq(id)
                            .and(field(name("deleted_at"), OffsetDateTime.class).isNull()))
                    .fetchOne(record -> new ResourceInfo(
                            type,
                            id,
                            record.value1(),
                            "PRIVATE",
                            null,
                            null,
                            "USER",
                            record.value2()));
            case TEMPLATE -> null;
        };
    }

    private ResourceInfo findKnowledgeBase(UUID id) {
        if (id == null) {
            return null;
        }
        return dsl.select(
                        field(name("workspace_id"), UUID.class),
                        field(name("visibility"), String.class),
                        field(name("team_id"), UUID.class),
                        field(name("owner_type"), String.class),
                        field(name("owner_id"), UUID.class))
                .from(table(name("knowledge_bases")))
                .where(field(name("id"), UUID.class)
                        .eq(id)
                        .and(field(name("archived_at"), OffsetDateTime.class).isNull()))
                .fetchOne(record -> new ResourceInfo(
                        ResourceType.KNOWLEDGE_BASE,
                        id,
                        record.value1(),
                        record.value2(),
                        record.value3(),
                        id,
                        record.value4(),
                        record.value5()));
    }

    private long bumpPermissionVersion(UUID workspaceId, OffsetDateTime now) {
        return dsl.insertInto(table(name("permission_versions")))
                .columns(
                        field(name("workspace_id"), UUID.class),
                        field(name("version"), Long.class),
                        field(name("updated_at"), OffsetDateTime.class))
                .values(workspaceId, 2L, now)
                .onConflict(field(name("workspace_id"), UUID.class))
                .doUpdate()
                .set(
                        field(name("version"), Long.class),
                        field(name("permission_versions", "version"), Long.class).plus(1L))
                .set(field(name("updated_at"), OffsetDateTime.class), now)
                .returning(field(name("version"), Long.class))
                .fetchOne(field(name("version"), Long.class));
    }

    private void softDeleteMatching(UpsertAclCommand command, OffsetDateTime now) {
        var condition = field(name("resource_type"), String.class)
                .eq(command.resourceType().name())
                .and(field(name("resource_id"), UUID.class).eq(command.resourceId()))
                .and(field(name("subject_type"), String.class)
                        .eq(command.subjectType().toUpperCase(Locale.ROOT)))
                .and(field(name("deleted_at"), OffsetDateTime.class).isNull());
        if (command.subjectId() == null) {
            condition = condition.and(field(name("subject_id"), UUID.class).isNull());
        } else {
            condition = condition.and(field(name("subject_id"), UUID.class)
                    .eq(command.subjectId()));
        }
        dsl.update(ACL)
                .set(field(name("deleted_at"), OffsetDateTime.class), now)
                .set(field(name("updated_at"), OffsetDateTime.class), now)
                .where(condition)
                .execute();
    }

    private void validateSubjectWorkspace(UpsertAclCommand command, UUID workspaceId) {
        String subjectType = command.subjectType().toUpperCase(Locale.ROOT);
        if ("PUBLIC".equals(subjectType)) {
            return;
        }
        boolean inWorkspace = switch (subjectType) {
            case "USER" -> dsl.fetchExists(dsl.selectOne()
                    .from(table(name("workspace_memberships")))
                    .where(field(name("workspace_id"), UUID.class).eq(workspaceId)
                            .and(field(name("user_id"), UUID.class).eq(command.subjectId()))));
            case "TEAM" -> dsl.fetchExists(dsl.selectOne()
                    .from(table(name("teams")))
                    .where(field(name("workspace_id"), UUID.class).eq(workspaceId)
                            .and(field(name("id"), UUID.class).eq(command.subjectId()))
                            .and(field(name("deleted_at"), OffsetDateTime.class).isNull())));
            case "GROUP" -> dsl.fetchExists(dsl.selectOne()
                    .from(table(name("workspace_user_groups")))
                    .where(field(name("workspace_id"), UUID.class).eq(workspaceId)
                            .and(field(name("id"), UUID.class).eq(command.subjectId()))
                            .and(field(name("deleted_at"), OffsetDateTime.class).isNull())));
            case "INVITE" -> dsl.fetchExists(dsl.selectOne()
                    .from(table(name("invitations")))
                    .where(field(name("workspace_id"), UUID.class).eq(workspaceId)
                            .and(field(name("id"), UUID.class).eq(command.subjectId()))));
            case "API_CLIENT" -> dsl.fetchExists(dsl.selectOne()
                    .from(table(name("oauth_clients")))
                    .where(field(name("workspace_id"), UUID.class).eq(workspaceId)
                            .and(field(name("id"), UUID.class).eq(command.subjectId()))));
            default -> false;
        };
        if (!inWorkspace) {
            throw new IllegalArgumentException("ACL subject must belong to the resource workspace");
        }
    }

    private AclEntryView mapAcl(Record record) {
        return new AclEntryView(
                record.get(field(name("id"), UUID.class)),
                record.get(field(name("workspace_id"), UUID.class)),
                ResourceType.valueOf(record.get(field(name("resource_type"), String.class))),
                record.get(field(name("resource_id"), UUID.class)),
                record.get(field(name("subject_type"), String.class)),
                record.get(field(name("subject_id"), UUID.class)),
                record.get(field(name("role"), String.class)),
                record.get(field(name("effect"), String.class)),
                capabilities(record),
                record.get(field(name("created_by"), UUID.class)),
                record.get(field(name("created_at"), OffsetDateTime.class)),
                record.get(field(name("updated_at"), OffsetDateTime.class)));
    }

    private Set<Capability> capabilities(Record record) {
        JSONB json = record.get(field(name("capabilities"), JSONB.class));
        if (json == null) {
            return Set.of();
        }
        List<String> values = objectMapper.readValue(
                json.data(), new TypeReference<List<String>>() {});
        return values.stream()
                .map(Capability::valueOf)
                .collect(Collectors.toUnmodifiableSet());
    }

    private static Set<Capability> workspaceRoleCapabilities(String role) {
        if (role == null) {
            return Set.of();
        }
        return switch (role) {
            case "OWNER", "ADMIN" -> ALL;
            case "MEMBER" -> Set.of(Capability.READ);
            case "EXTERNAL" -> Set.of(Capability.READ);
            default -> Set.of();
        };
    }

    private static Set<Capability> tenantCeiling(String role) {
        if (role == null) {
            return Set.of(Capability.READ);
        }
        return switch (role) {
            case "OWNER", "ADMIN" -> ALL;
            case "MEMBER" -> Set.of(
                    Capability.READ,
                    Capability.EDIT,
                    Capability.COMMENT,
                    Capability.PUBLISH,
                    Capability.SHARE,
                    Capability.COPY,
                    Capability.DOWNLOAD,
                    Capability.EXPORT,
                    Capability.DELETE,
                    Capability.RESTORE,
                    Capability.VIEW_ANALYTICS);
            case "EXTERNAL" -> Set.of(
                    Capability.READ, Capability.COMMENT, Capability.COPY);
            default -> Set.of();
        };
    }

    private static Set<Capability> roleCapabilities(String role) {
        if (role == null) {
            return Set.of();
        }
        return switch (role.toUpperCase(Locale.ROOT)) {
            case "OWNER", "ADMIN", "MANAGER" -> ALL;
            case "EDITOR", "MEMBER" -> CONTENT_EDITOR;
            case "READER", "VIEWER" -> CONTENT_READER;
            default -> throw new IllegalArgumentException("ACL role is invalid");
        };
    }

    private static void validateCommand(UpsertAclCommand command) {
        if (command == null
                || command.resourceType() == null
                || command.resourceId() == null
                || command.subjectType() == null
                || command.effect() == null
                || command.capabilities() == null) {
            throw new IllegalArgumentException("ACL command is incomplete");
        }
        String subjectType = command.subjectType().toUpperCase(Locale.ROOT);
        if (!Set.of("USER", "GROUP", "TEAM", "PUBLIC", "INVITE", "API_CLIENT")
                .contains(subjectType)) {
            throw new IllegalArgumentException("ACL subject type is invalid");
        }
        if (("PUBLIC".equals(subjectType)) != (command.subjectId() == null)) {
            throw new IllegalArgumentException("ACL subject id is invalid");
        }
        if (!Set.of("ALLOW", "DENY").contains(command.effect().toUpperCase(Locale.ROOT))) {
            throw new IllegalArgumentException("ACL effect is invalid");
        }
        if (command.role() != null) {
            roleCapabilities(command.role());
        }
    }

    private static String normalizeNullable(String value) {
        return value == null || value.isBlank() ? null : value.toUpperCase(Locale.ROOT);
    }

    private record ResourceInfo(
            ResourceType type,
            UUID id,
            UUID workspaceId,
            String visibility,
            UUID teamId,
            UUID knowledgeBaseId,
            String ownerType,
            UUID ownerId) {}
}
