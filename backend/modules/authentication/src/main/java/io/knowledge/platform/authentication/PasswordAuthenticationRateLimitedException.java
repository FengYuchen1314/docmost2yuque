package io.knowledge.platform.authentication;

public final class PasswordAuthenticationRateLimitedException extends RuntimeException {

    private static final long serialVersionUID = 1L;

    public PasswordAuthenticationRateLimitedException() {
        super("Too many password login attempts; try again in 15 minutes");
    }
}
