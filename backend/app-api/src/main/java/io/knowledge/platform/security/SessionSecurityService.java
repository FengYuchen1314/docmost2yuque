package io.knowledge.platform.security;

import io.knowledge.platform.identity.AuthenticatedIdentity;
import io.knowledge.platform.identity.IdentitySessionManagement;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.util.ArrayList;
import java.util.List;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContext;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.web.context.SecurityContextRepository;
import org.springframework.stereotype.Service;

@Service
public final class SessionSecurityService {

    private final SecurityContextRepository securityContextRepository;
    private final IdentitySessionManagement sessions;

    public SessionSecurityService(
            SecurityContextRepository securityContextRepository,
            IdentitySessionManagement sessions) {
        this.securityContextRepository = securityContextRepository;
        this.sessions = sessions;
    }

    public void establish(
            AuthenticatedIdentity identity,
            HttpServletRequest request,
            HttpServletResponse response) {
        PlatformPrincipal principal = new PlatformPrincipal(
                identity.userId(), identity.email(), identity.instanceAdmin());
        List<GrantedAuthority> authorities = new ArrayList<>();
        authorities.add(new SimpleGrantedAuthority("ROLE_USER"));
        if (identity.instanceAdmin()) {
            authorities.add(new SimpleGrantedAuthority("ROLE_INSTANCE_ADMIN"));
        }
        Authentication authentication = UsernamePasswordAuthenticationToken.authenticated(
                principal, null, List.copyOf(authorities));
        SecurityContext context = SecurityContextHolder.createEmptyContext();
        context.setAuthentication(authentication);
        SecurityContextHolder.setContext(context);
        request.getSession(true);
        request.changeSessionId();
        securityContextRepository.saveContext(context, request, response);
        sessions.touch(
                identity.userId(),
                request.getSession(false).getId(),
                request.getHeader("User-Agent"),
                clientAddress(request));
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
