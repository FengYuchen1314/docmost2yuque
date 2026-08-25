package io.knowledge.platform.authentication;

public final class AuthenticationRateLimitedException extends RuntimeException {

    private static final long serialVersionUID = 1L;

    public AuthenticationRateLimitedException() {
        super("Too many email code requests; try again later");
    }
}
