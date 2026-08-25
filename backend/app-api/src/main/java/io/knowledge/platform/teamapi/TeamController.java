package io.knowledge.platform.teamapi;

import io.knowledge.platform.audit.AuditEventPageView;
import io.knowledge.platform.security.PlatformPrincipal;
import io.knowledge.platform.team.CreateTeamCommand;
import io.knowledge.platform.team.TeamMemberView;
import io.knowledge.platform.team.TeamService;
import io.knowledge.platform.team.TeamView;
import io.knowledge.platform.team.UpdateTeamCommand;
import java.util.List;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/teams")
final class TeamController {

    private final TeamService teamService;

    TeamController(TeamService teamService) {
        this.teamService = teamService;
    }

    @PostMapping("/list")
    List<TeamView> list(
            @RequestBody TeamRequests.WorkspaceId request,
            @AuthenticationPrincipal PlatformPrincipal principal) {
        return teamService.list(principal.userId(), request.workspaceId());
    }

    @PostMapping("/create")
    ResponseEntity<TeamView> create(
            @RequestBody TeamRequests.Create request,
            @AuthenticationPrincipal PlatformPrincipal principal) {
        TeamView team = teamService.create(
                principal.userId(),
                new CreateTeamCommand(
                        request.workspaceId(),
                        request.name(),
                        request.slug(),
                        request.description(),
                        request.avatar(),
                        request.visibility()));
        return ResponseEntity.status(201).body(team);
    }

    @PostMapping("/update")
    TeamView update(
            @RequestBody TeamRequests.Update request,
            @AuthenticationPrincipal PlatformPrincipal principal) {
        return teamService.update(
                principal.userId(),
                new UpdateTeamCommand(
                        request.teamId(),
                        request.name(),
                        request.slug(),
                        request.description(),
                        request.avatar(),
                        request.visibility()));
    }

    @PostMapping("/delete")
    ResponseEntity<Void> delete(
            @RequestBody TeamRequests.TeamId request,
            @AuthenticationPrincipal PlatformPrincipal principal) {
        teamService.delete(principal.userId(), request.teamId());
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/members")
    List<TeamMemberView> members(
            @RequestBody TeamRequests.TeamId request,
            @AuthenticationPrincipal PlatformPrincipal principal) {
        return teamService.members(principal.userId(), request.teamId());
    }

    @PostMapping("/members/add")
    TeamMemberView addMember(
            @RequestBody TeamRequests.Member request,
            @AuthenticationPrincipal PlatformPrincipal principal) {
        return teamService.addMember(
                principal.userId(), request.teamId(), request.userId(), request.role());
    }

    @PostMapping("/members/update")
    TeamMemberView updateMember(
            @RequestBody TeamRequests.Member request,
            @AuthenticationPrincipal PlatformPrincipal principal) {
        return teamService.updateMember(
                principal.userId(), request.teamId(), request.userId(), request.role());
    }

    @PostMapping("/members/remove")
    ResponseEntity<Void> removeMember(
            @RequestBody TeamRequests.Member request,
            @AuthenticationPrincipal PlatformPrincipal principal) {
        teamService.removeMember(principal.userId(), request.teamId(), request.userId());
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/members/leave")
    ResponseEntity<Void> leave(
            @RequestBody TeamRequests.TeamId request,
            @AuthenticationPrincipal PlatformPrincipal principal) {
        teamService.leave(principal.userId(), request.teamId());
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/activity/page")
    AuditEventPageView activity(
            @RequestBody TeamRequests.Activity request,
            @AuthenticationPrincipal PlatformPrincipal principal) {
        return teamService.activity(
                principal.userId(),
                request.teamId(),
                request.limit() == null ? 25 : request.limit(),
                request.offset() == null ? 0 : request.offset());
    }
}
