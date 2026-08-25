package io.knowledge.platform.usergroupapi;

import io.knowledge.platform.security.PlatformPrincipal;
import io.knowledge.platform.usergroup.UserGroupMemberView;
import io.knowledge.platform.usergroup.UserGroupService;
import io.knowledge.platform.usergroup.UserGroupView;
import java.util.List;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/user-groups")
final class UserGroupController {

    private final UserGroupService service;

    UserGroupController(UserGroupService service) {
        this.service = service;
    }

    @PostMapping("/list")
    List<UserGroupView> list(
            @RequestBody UserGroupRequests.Workspace request,
            @AuthenticationPrincipal PlatformPrincipal principal) {
        return service.list(principal.userId(), request.workspaceId());
    }

    @PostMapping("/create")
    ResponseEntity<UserGroupView> create(
            @RequestBody UserGroupRequests.Create request,
            @AuthenticationPrincipal PlatformPrincipal principal) {
        return ResponseEntity.status(201).body(service.create(
                principal.userId(), request.workspaceId(), request.name(), request.description()));
    }

    @PostMapping("/update")
    UserGroupView update(
            @RequestBody UserGroupRequests.Update request,
            @AuthenticationPrincipal PlatformPrincipal principal) {
        return service.update(
                principal.userId(), request.groupId(), request.name(), request.description());
    }

    @PostMapping("/delete")
    ResponseEntity<Void> delete(
            @RequestBody UserGroupRequests.Id request,
            @AuthenticationPrincipal PlatformPrincipal principal) {
        service.delete(principal.userId(), request.groupId());
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/members")
    List<UserGroupMemberView> members(
            @RequestBody UserGroupRequests.Id request,
            @AuthenticationPrincipal PlatformPrincipal principal) {
        return service.members(principal.userId(), request.groupId());
    }

    @PostMapping("/members/add")
    List<UserGroupMemberView> addMember(
            @RequestBody UserGroupRequests.Member request,
            @AuthenticationPrincipal PlatformPrincipal principal) {
        return service.addMember(principal.userId(), request.groupId(), request.userId());
    }

    @PostMapping("/members/remove")
    List<UserGroupMemberView> removeMember(
            @RequestBody UserGroupRequests.Member request,
            @AuthenticationPrincipal PlatformPrincipal principal) {
        return service.removeMember(principal.userId(), request.groupId(), request.userId());
    }
}
