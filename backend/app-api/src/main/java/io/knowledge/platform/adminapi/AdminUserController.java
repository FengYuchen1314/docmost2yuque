package io.knowledge.platform.adminapi;

import io.knowledge.platform.identity.IdentityAdministration;
import io.knowledge.platform.identity.InstanceUserView;
import io.knowledge.platform.identity.InstanceUserPageView;
import io.knowledge.platform.security.PlatformPrincipal;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.List;
import java.util.UUID;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/admin/users")
final class AdminUserController {

    private final IdentityAdministration users;

    AdminUserController(IdentityAdministration users) {
        this.users = users;
    }

    @PostMapping("/list")
    List<InstanceUserView> list(@Valid @RequestBody UserListRequest request) {
        return users.list(
                request.query(),
                request.status(),
                request.limit() == null ? 100 : request.limit());
    }

    @PostMapping("/page")
    InstanceUserPageView page(@Valid @RequestBody UserListRequest request) {
        return users.page(
                request.query(),
                request.status(),
                request.limit() == null ? 30 : request.limit(),
                request.offset() == null ? 0 : request.offset());
    }

    @PostMapping("/status")
    InstanceUserView status(
            @Valid @RequestBody UserStatusRequest request,
            @AuthenticationPrincipal PlatformPrincipal principal) {
        return users.updateStatus(principal.userId(), request.userId(), request.status());
    }

    @PostMapping("/administrator")
    InstanceUserView administrator(
            @Valid @RequestBody AdministratorRequest request,
            @AuthenticationPrincipal PlatformPrincipal principal) {
        return users.updateAdministrator(
                principal.userId(), request.userId(), request.administrator());
    }

    record UserListRequest(
            @Size(max = 200) String query,
            @Size(max = 32) String status,
            @Min(1) @Max(500) Integer limit,
            @Min(0) Integer offset) {}

    record UserStatusRequest(@NotNull UUID userId, @NotBlank @Size(max = 32) String status) {}

    record AdministratorRequest(@NotNull UUID userId, boolean administrator) {}
}
