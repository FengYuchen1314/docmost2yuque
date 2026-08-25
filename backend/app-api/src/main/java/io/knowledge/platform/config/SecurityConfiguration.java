package io.knowledge.platform.config;

import io.knowledge.platform.collaboration.CollaborationSessionService;
import io.knowledge.platform.integrationapi.OpenPlatformAuthenticationFilter;
import io.knowledge.platform.identity.IdentitySessionManagement;
import io.knowledge.platform.security.ManagedSessionFilter;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.servlet.DispatcherType;
import org.springframework.http.MediaType;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.crypto.argon2.Argon2PasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.context.HttpSessionSecurityContextRepository;
import org.springframework.security.web.context.SecurityContextRepository;
import org.springframework.security.web.context.SecurityContextHolderFilter;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;

@Configuration(proxyBeanMethods = false)
class SecurityConfiguration {

    @Bean
    PasswordEncoder passwordEncoder() {
        return Argon2PasswordEncoder.defaultsForSpringSecurity_v5_8();
    }

    @Bean
    SecurityContextRepository securityContextRepository() {
        return new HttpSessionSecurityContextRepository();
    }

    @Bean
    SecurityFilterChain securityFilterChain(
            HttpSecurity http,
            SecurityContextRepository securityContextRepository,
            CollaborationSessionService collaborationSessions,
            IdentitySessionManagement identitySessions,
            ManagedSessionFilter managedSessions,
            OpenPlatformAuthenticationFilter openPlatformAuthentication)
            throws Exception {
        http.csrf(csrf -> csrf.ignoringRequestMatchers(
                        "/api/internal/**",
                        "/api/v1/setup/**",
                        "/api/v1/auth/login/**",
                        "/api/v1/auth/register/**",
                        "/api/v1/auth/password-reset/**",
                        "/api/v1/invitations/**",
                        "/api/v1/shares/resolve",
                        "/api/v1/shares/verify-password",
                        "/api/v1/shares/download",
                        "/api/v1/shares/export",
                        "/api/v1/shares/comments/list",
                        "/api/v1/shares/comments/page",
                        "/api/public/**",
                        "/api/v2/**",
                        "/oauth/token",
                        "/mcp/**",
                        "/mcp"))
                .securityContext(context -> context
                        .securityContextRepository(securityContextRepository)
                        .requireExplicitSave(true))
                .authorizeHttpRequests(authorize -> authorize
                        .dispatcherTypeMatchers(DispatcherType.ERROR)
                        .permitAll()
                        .requestMatchers(
                                "/api/internal/**",
                                "/api/v1/setup/**",
                                "/api/v1/auth/login/**",
                                "/api/v1/auth/register/**",
                                "/api/v1/auth/password-reset/**",
                                "/api/v1/auth/registration-status",
                                "/api/v1/invitations/**",
                                "/api/v1/shares/resolve",
                                "/api/v1/shares/verify-password",
                                "/api/v1/shares/download",
                                "/api/v1/shares/export",
                                "/api/v1/shares/comments/list",
                                "/api/v1/shares/comments/page",
                                "/api/public/**",
                                "/oauth/token",
                                "/actuator/health/**")
                        .permitAll()
                        .requestMatchers(HttpMethod.GET, "/api/v1/attachments/*/content")
                        .permitAll()
                        .requestMatchers(HttpMethod.GET, "/api/v1/attachments/*/shared-content")
                        .permitAll()
                        .requestMatchers("/api/v1/admin/**")
                        .hasRole("INSTANCE_ADMIN")
                        .anyRequest()
                        .authenticated())
                .addFilterBefore(openPlatformAuthentication, UsernamePasswordAuthenticationFilter.class)
                .addFilterAfter(managedSessions, SecurityContextHolderFilter.class)
                .exceptionHandling(exceptions -> exceptions.authenticationEntryPoint(
                        (request, response, exception) -> {
                            response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
                            response.setContentType(MediaType.APPLICATION_PROBLEM_JSON_VALUE);
                            response.getWriter().write(
                                    "{\"type\":\"https://errors.knowledge.local/AUTHENTICATION_REQUIRED\","
                                            + "\"title\":\"Unauthorized\",\"status\":401,"
                                            + "\"code\":\"AUTHENTICATION_REQUIRED\"}");
                        }))
                .formLogin(AbstractHttpConfigurer::disable)
                .httpBasic(AbstractHttpConfigurer::disable)
                .logout(logout -> logout
                        .addLogoutHandler((request, response, authentication) -> {
                            var session = request.getSession(false);
                            if (session != null) {
                                collaborationSessions.revoke(session.getId());
                                identitySessions.revokeHttpSession(session.getId(), "LOGOUT");
                            }
                        })
                        .logoutSuccessHandler((request, response, authentication) ->
                                response.setStatus(HttpServletResponse.SC_NO_CONTENT))
                        .logoutUrl("/api/v1/auth/logout"));
        return http.build();
    }
}
