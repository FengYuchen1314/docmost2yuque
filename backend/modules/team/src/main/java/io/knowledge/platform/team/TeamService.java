package io.knowledge.platform.team;

import io.knowledge.platform.audit.AuditService;
import io.knowledge.platform.audit.AuditEventPageView;
import io.knowledge.platform.authorization.AuthorizationService;
import io.knowledge.platform.authorization.Capability;
import io.knowledge.platform.authorization.ResourceNotFoundException;
import io.knowledge.platform.authorization.ResourceType;
import io.knowledge.platform.common.DomainConflictException;
import io.knowledge.platform.common.Ids;
import io.knowledge.platform.search.SearchDocumentCommand;
import io.knowledge.platform.search.SearchIndexWriter;
import java.time.Clock;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class TeamService {

    private static final Pattern SLUG =
            Pattern.compile("[\\p{L}\\p{N}]+(?:-[\\p{L}\\p{N}]+)*");
    private final TeamRepository repository;
    private final AuthorizationService authorization;
    private final AuditService auditService;
    private final SearchIndexWriter searchIndex;
    private final Clock clock;

    public TeamService(
            TeamRepository repository,
            AuthorizationService authorization,
            AuditService auditService,
            SearchIndexWriter searchIndex,
            Clock clock) {
        this.repository = repository;
        this.authorization = authorization;
        this.auditService = auditService;
        this.searchIndex = searchIndex;
        this.clock = clock;
    }

    @Transactional
    public TeamView create(UUID actorId, CreateTeamCommand command) {
        requireCommand(command);
        authorization.require(
                actorId, ResourceType.WORKSPACE, command.workspaceId(), Capability.MANAGE);
        if (!repository.isOrganizationWorkspace(command.workspaceId())) {
            throw new DomainConflictException(
                    "PERSONAL_WORKSPACE_TEAMS_DISABLED",
                    "Teams can only be created in an organization workspace");
        }
        OffsetDateTime now = OffsetDateTime.now(clock);
        TeamView team = new TeamView(
                Ids.next(),
                command.workspaceId(),
                requireName(command.name()),
                requireSlug(command.slug()),
                trimNullable(command.description(), 4_000, "Team description"),
                trimNullable(command.avatar(), 2_000, "Team avatar"),
                requireVisibility(command.visibility()),
                actorId,
                now,
                now);
        try {
            repository.insert(team);
            repository.addMember(team.id(), actorId, "MANAGER", now);
        } catch (DuplicateKeyException exception) {
            throw new DomainConflictException("TEAM_SLUG_CONFLICT", "Team slug is already in use");
        }
        authorization.invalidateWorkspace(team.workspaceId());
        index(actorId, team);
        auditService.success(team.workspaceId(), actorId, "team.create", "TEAM", team.id());
        return team;
    }

    @Transactional(readOnly = true)
    public List<TeamView> list(UUID actorId, UUID workspaceId) {
        authorization.require(actorId, ResourceType.WORKSPACE, workspaceId, Capability.READ);
        return repository.list(workspaceId).stream()
                .filter(team -> authorization
                        .resolve(actorId, ResourceType.TEAM, team.id())
                        .allows(Capability.READ))
                .toList();
    }

    @Transactional
    public TeamView update(UUID actorId, UpdateTeamCommand command) {
        if (command == null || command.teamId() == null) {
            throw new IllegalArgumentException("Team id is required");
        }
        authorization.require(actorId, ResourceType.TEAM, command.teamId(), Capability.MANAGE);
        TeamView current = requireTeam(command.teamId());
        TeamView updated = new TeamView(
                current.id(),
                current.workspaceId(),
                requireName(command.name()),
                requireSlug(command.slug()),
                trimNullable(command.description(), 4_000, "Team description"),
                trimNullable(command.avatar(), 2_000, "Team avatar"),
                requireVisibility(command.visibility()),
                current.createdBy(),
                current.createdAt(),
                OffsetDateTime.now(clock));
        try {
            repository.update(updated);
        } catch (DuplicateKeyException exception) {
            throw new DomainConflictException("TEAM_SLUG_CONFLICT", "Team slug is already in use");
        }
        auditService.success(
                updated.workspaceId(), actorId, "team.update", "TEAM", updated.id());
        authorization.invalidateWorkspace(updated.workspaceId());
        index(actorId, updated);
        return updated;
    }

    @Transactional
    public void delete(UUID actorId, UUID teamId) {
        authorization.require(actorId, ResourceType.TEAM, teamId, Capability.DELETE);
        TeamView team = requireTeam(teamId);
        if (repository.hasActiveKnowledgeBases(teamId)) {
            throw new DomainConflictException(
                    "TEAM_HAS_KNOWLEDGE_BASES",
                    "Transfer or archive the team's knowledge bases before deleting it");
        }
        repository.softDelete(teamId, OffsetDateTime.now(clock));
        searchIndex.delete(teamId);
        authorization.invalidateWorkspace(team.workspaceId());
        auditService.success(team.workspaceId(), actorId, "team.delete", "TEAM", teamId);
    }

    @Transactional(readOnly = true)
    public List<TeamMemberView> members(UUID actorId, UUID teamId) {
        authorization.require(actorId, ResourceType.TEAM, teamId, Capability.READ);
        return repository.listMembers(teamId);
    }

    @Transactional
    public TeamMemberView addMember(
            UUID actorId,
            UUID teamId,
            UUID userId,
            String role) {
        authorization.require(actorId, ResourceType.TEAM, teamId, Capability.MANAGE);
        TeamView team = requireTeam(teamId);
        String normalizedRole = requireRole(role);
        if (!repository.isWorkspaceMember(team.workspaceId(), userId)) {
            throw new IllegalArgumentException("Team member must belong to the same workspace");
        }
        OffsetDateTime now = OffsetDateTime.now(clock);
        try {
            repository.addMember(teamId, userId, normalizedRole, now);
        } catch (DuplicateKeyException exception) {
            throw new DomainConflictException(
                    "TEAM_MEMBER_EXISTS", "The user is already a member of this team");
        }
        authorization.invalidateWorkspace(team.workspaceId());
        auditService.success(team.workspaceId(), actorId, "team.member.add", "TEAM", teamId);
        return repository.listMembers(teamId).stream()
                .filter(member -> member.userId().equals(userId))
                .findFirst()
                .orElseThrow(ResourceNotFoundException::new);
    }

    @Transactional
    public TeamMemberView updateMember(
            UUID actorId,
            UUID teamId,
            UUID userId,
            String role) {
        authorization.require(actorId, ResourceType.TEAM, teamId, Capability.MANAGE);
        TeamView team = requireTeam(teamId);
        String currentRole = repository.memberRole(teamId, userId);
        if (currentRole == null) {
            throw new ResourceNotFoundException();
        }
        String normalizedRole = requireRole(role);
        if ("MANAGER".equals(currentRole)
                && !"MANAGER".equals(normalizedRole)
                && repository.managerCountForUpdate(teamId) <= 1) {
            throw lastManagerConflict();
        }
        repository.updateMember(teamId, userId, normalizedRole, OffsetDateTime.now(clock));
        authorization.invalidateWorkspace(team.workspaceId());
        auditService.success(
                team.workspaceId(), actorId, "team.member.update", "TEAM", teamId);
        return repository.listMembers(teamId).stream()
                .filter(member -> member.userId().equals(userId))
                .findFirst()
                .orElseThrow(ResourceNotFoundException::new);
    }

    @Transactional
    public void removeMember(UUID actorId, UUID teamId, UUID userId) {
        authorization.require(actorId, ResourceType.TEAM, teamId, Capability.MANAGE);
        TeamView team = requireTeam(teamId);
        String currentRole = repository.memberRole(teamId, userId);
        if (currentRole == null) {
            throw new ResourceNotFoundException();
        }
        if ("MANAGER".equals(currentRole) && repository.managerCountForUpdate(teamId) <= 1) {
            throw lastManagerConflict();
        }
        repository.removeMember(teamId, userId);
        authorization.invalidateWorkspace(team.workspaceId());
        auditService.success(
                team.workspaceId(), actorId, "team.member.remove", "TEAM", teamId);
    }

    @Transactional
    public void leave(UUID actorId, UUID teamId) {
        TeamView team = requireTeam(teamId);
        String currentRole = repository.memberRole(teamId, actorId);
        if (currentRole == null) {
            throw new ResourceNotFoundException();
        }
        if ("MANAGER".equals(currentRole) && repository.managerCountForUpdate(teamId) <= 1) {
            throw lastManagerConflict();
        }
        repository.removeMember(teamId, actorId);
        authorization.invalidateWorkspace(team.workspaceId());
        auditService.success(
                team.workspaceId(), actorId, "team.member.leave", "TEAM", teamId);
    }

    @Transactional(readOnly = true)
    public AuditEventPageView activity(UUID actorId, UUID teamId, int limit, int offset) {
        authorization.require(actorId, ResourceType.TEAM, teamId, Capability.READ);
        TeamView team = requireTeam(teamId);
        return auditService.pageForResource(
                team.workspaceId(), "TEAM", teamId, limit, offset);
    }

    private TeamView requireTeam(UUID teamId) {
        TeamView team = repository.find(teamId);
        if (team == null) {
            throw new ResourceNotFoundException();
        }
        return team;
    }

    private void index(UUID actorId, TeamView team) {
        var decision = authorization.resolve(actorId, ResourceType.TEAM, team.id());
        var metadata = tools.jackson.databind.node.JsonNodeFactory.instance.objectNode();
        if (team.avatar() != null) metadata.put("avatar", team.avatar());
        searchIndex.upsert(new SearchDocumentCommand(
                team.id(), team.workspaceId(), "TEAM", team.id(), "CANONICAL",
                team.name(), team.description(), List.of(), team.slug(), team.createdBy(), null,
                team.visibility(), null, decision.permissionVersion(), metadata,
                team.createdAt(), team.updatedAt()));
    }

    private static void requireCommand(CreateTeamCommand command) {
        if (command == null || command.workspaceId() == null) {
            throw new IllegalArgumentException("Workspace id is required");
        }
    }

    private static String requireName(String value) {
        if (value == null || value.trim().length() < 2 || value.trim().length() > 120) {
            throw new IllegalArgumentException("Team name must be between 2 and 120 characters");
        }
        return value.trim();
    }

    private static String requireSlug(String value) {
        if (value == null) {
            throw new IllegalArgumentException("Team slug is required");
        }
        String normalized = value.trim().toLowerCase(Locale.ROOT);
        if (normalized.length() < 2
                || normalized.length() > 80
                || !SLUG.matcher(normalized).matches()) {
            throw new IllegalArgumentException("Team slug is invalid");
        }
        return normalized;
    }

    private static String requireVisibility(String value) {
        String normalized = value == null ? "PRIVATE" : value.toUpperCase(Locale.ROOT);
        if (!Set.of("PRIVATE", "WORKSPACE").contains(normalized)) {
            throw new IllegalArgumentException("Team visibility is invalid");
        }
        return normalized;
    }

    private static String requireRole(String value) {
        if (value == null) {
            throw new IllegalArgumentException("Team role is required");
        }
        String normalized = value.toUpperCase(Locale.ROOT);
        if (!Set.of("MANAGER", "MEMBER").contains(normalized)) {
            throw new IllegalArgumentException("Team role is invalid");
        }
        return normalized;
    }

    private static String trimNullable(String value, int max, String label) {
        if (value == null || value.isBlank()) {
            return null;
        }
        String normalized = value.trim();
        if (normalized.length() > max) {
            throw new IllegalArgumentException(label + " is too long");
        }
        return normalized;
    }

    private static DomainConflictException lastManagerConflict() {
        return new DomainConflictException(
                "TEAM_LAST_MANAGER", "A team must retain at least one manager");
    }
}
