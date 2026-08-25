package io.knowledge.platform.engagementapi;

import io.knowledge.platform.engagement.ActivityService;
import io.knowledge.platform.engagement.CommentService;
import io.knowledge.platform.engagement.CommentPageView;
import io.knowledge.platform.engagement.CommentView;
import io.knowledge.platform.engagement.FavoriteService;
import io.knowledge.platform.engagement.NotificationService;
import io.knowledge.platform.engagement.NotificationPage;
import io.knowledge.platform.engagement.NotificationView;
import io.knowledge.platform.engagement.WorkbenchItem;
import io.knowledge.platform.engagement.WorkbenchPage;
import io.knowledge.platform.engagement.WorkbenchService;
import io.knowledge.platform.security.PlatformPrincipal;
import java.util.List;
import java.util.Map;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1")
final class EngagementController {

    private final ActivityService activities;
    private final FavoriteService favorites;
    private final CommentService comments;
    private final NotificationService notifications;
    private final WorkbenchService workbench;

    EngagementController(
            ActivityService activities,
            FavoriteService favorites,
            CommentService comments,
            NotificationService notifications,
            WorkbenchService workbench) {
        this.activities = activities;
        this.favorites = favorites;
        this.comments = comments;
        this.notifications = notifications;
        this.workbench = workbench;
    }

    @PostMapping("/activities/page-view")
    ResponseEntity<Void> recordPageView(
            @RequestBody EngagementRequests.Page request,
            @AuthenticationPrincipal PlatformPrincipal principal) {
        activities.recordPageView(principal.userId(), request.pageId());
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/activities/page-views/clear")
    Map<String, Integer> clearPageViews(@AuthenticationPrincipal PlatformPrincipal principal) {
        return Map.of("deleted", activities.clearPageViews(principal.userId()));
    }

    @PostMapping("/favorites/set")
    Map<String, Boolean> setFavorite(
            @RequestBody EngagementRequests.Favorite request,
            @AuthenticationPrincipal PlatformPrincipal principal) {
        return Map.of(
                "favorite",
                favorites.setPageFavorite(
                        principal.userId(), request.pageId(), request.favorite()));
    }

    @PostMapping("/favorites/status")
    Map<String, Boolean> favoriteStatus(
            @RequestBody EngagementRequests.Page request,
            @AuthenticationPrincipal PlatformPrincipal principal) {
        return Map.of("favorite", favorites.isPageFavorite(principal.userId(), request.pageId()));
    }

    @PostMapping("/comments/list")
    List<CommentView> listComments(
            @RequestBody EngagementRequests.CommentList request,
            @AuthenticationPrincipal PlatformPrincipal principal) {
        return comments.list(principal.userId(), request.pageId());
    }

    @PostMapping("/comments/page")
    CommentPageView pageComments(
            @RequestBody EngagementRequests.CommentList request,
            @AuthenticationPrincipal PlatformPrincipal principal) {
        return comments.page(
                principal.userId(), request.pageId(),
                request.limit() == null ? 30 : request.limit(),
                request.offset() == null ? 0 : request.offset());
    }

    @PostMapping("/comments/create")
    ResponseEntity<CommentView> createComment(
            @RequestBody EngagementRequests.CommentCreate request,
            @AuthenticationPrincipal PlatformPrincipal principal) {
        CommentView comment = comments.create(
                principal.userId(), request.pageId(), request.parentId(), request.anchor(),
                request.body(), request.plainText(), request.mentionedUserIds());
        return ResponseEntity.status(201).body(comment);
    }

    @PostMapping("/comments/update")
    CommentView updateComment(
            @RequestBody EngagementRequests.CommentUpdate request,
            @AuthenticationPrincipal PlatformPrincipal principal) {
        return comments.update(
                principal.userId(), request.commentId(), request.body(), request.plainText());
    }

    @PostMapping("/comments/resolve")
    CommentView resolveComment(
            @RequestBody EngagementRequests.CommentResolve request,
            @AuthenticationPrincipal PlatformPrincipal principal) {
        return comments.resolve(
                principal.userId(), request.commentId(), request.resolved());
    }

    @PostMapping("/comments/delete")
    ResponseEntity<Void> deleteComment(
            @RequestBody EngagementRequests.CommentDelete request,
            @AuthenticationPrincipal PlatformPrincipal principal) {
        comments.delete(principal.userId(), request.commentId());
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/notifications/list")
    List<NotificationView> listNotifications(
            @RequestBody EngagementRequests.NotificationList request,
            @AuthenticationPrincipal PlatformPrincipal principal) {
        return notifications.list(
                principal.userId(), Boolean.TRUE.equals(request.unreadOnly()),
                request.limit() == null ? 50 : request.limit());
    }

    @PostMapping("/notifications/read")
    ResponseEntity<Void> readNotification(
            @RequestBody EngagementRequests.NotificationRead request,
            @AuthenticationPrincipal PlatformPrincipal principal) {
        notifications.read(principal.userId(), request.notificationId());
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/notifications/page")
    NotificationPage pageNotifications(
            @RequestBody EngagementRequests.NotificationList request,
            @AuthenticationPrincipal PlatformPrincipal principal) {
        return notifications.page(
                principal.userId(), Boolean.TRUE.equals(request.unreadOnly()), request.category(),
                request.offset() == null ? 0 : request.offset(),
                request.limit() == null ? 25 : request.limit());
    }

    @PostMapping("/notifications/read-all")
    ResponseEntity<Void> readAllNotifications(
            @AuthenticationPrincipal PlatformPrincipal principal) {
        notifications.readAll(principal.userId());
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/workbench/list")
    List<WorkbenchItem> workbench(
            @RequestBody EngagementRequests.WorkbenchList request,
            @AuthenticationPrincipal PlatformPrincipal principal) {
        return workbench.list(
                principal.userId(), request.reason(), request.limit() == null ? 50 : request.limit());
    }

    @PostMapping("/workbench/page")
    WorkbenchPage workbenchPage(
            @RequestBody EngagementRequests.WorkbenchList request,
            @AuthenticationPrincipal PlatformPrincipal principal) {
        return workbench.page(
                principal.userId(), request.reason(), request.offset() == null ? 0 : request.offset(),
                request.limit() == null ? 25 : request.limit());
    }
}
