package io.knowledge.platform.publication;

public final class DatabaseFormRateLimitedException extends RuntimeException {

    private static final long serialVersionUID = 1L;

    public DatabaseFormRateLimitedException() {
        super("Too many form submissions; try again later");
    }
}
