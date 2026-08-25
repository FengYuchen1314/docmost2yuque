package io.knowledge.platform.security;

import io.knowledge.platform.collaboration.CollaborationSessionService;
import io.knowledge.platform.identity.IdentitySessionManagement;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import org.springframework.http.MediaType;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

@Component
public final class ManagedSessionFilter extends OncePerRequestFilter {

    private final IdentitySessionManagement sessions;
    private final CollaborationSessionService collaborationSessions;

    public ManagedSessionFilter(
            IdentitySessionManagement sessions,
            CollaborationSessionService collaborationSessions) {
        this.sessions = sessions;
        this.collaborationSessions = collaborationSessions;
    }

    @Override
    protected void doFilterInternal(
            HttpServletRequest request,
            HttpServletResponse response,
            FilterChain filterChain) throws ServletException, IOException {
        var authentication = SecurityContextHolder.getContext().getAuthentication();
        var session = request.getSession(false);
        if (authentication == null
                || !(authentication.getPrincipal() instanceof PlatformPrincipal principal)
                || session == null) {
            filterChain.doFilter(request, response);
            return;
        }
        boolean active = sessions.touch(
                principal.userId(), session.getId(), request.getHeader("User-Agent"),
                clientAddress(request));
        if (active) {
            filterChain.doFilter(request, response);
            return;
        }
        collaborationSessions.revoke(session.getId());
        SecurityContextHolder.clearContext();
        session.invalidate();
        response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
        response.setContentType(MediaType.APPLICATION_PROBLEM_JSON_VALUE);
        response.getWriter().write(
                "{\"type\":\"https://errors.knowledge.local/LOGIN_SESSION_REVOKED\","
                        + "\"title\":\"Unauthorized\",\"status\":401,"
                        + "\"code\":\"LOGIN_SESSION_REVOKED\","
                        + "\"detail\":\"This login session has been revoked\"}");
    }

    private static String clientAddress(HttpServletRequest request) {
        String forwarded = request.getHeader("X-Forwarded-For");
        if (forwarded != null && !forwarded.isBlank()) {
            int separator = forwarded.indexOf(',');
            return (separator < 0 ? forwarded : forwarded.substring(0, separator)).trim();
        }
        return request.getRemoteAddr();
    }
}
