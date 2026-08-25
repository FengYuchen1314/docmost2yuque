package io.knowledge.platform.share;

public final class ShareRateLimitedException extends RuntimeException {

    private static final long serialVersionUID = 1L;

    public ShareRateLimitedException() {
        super("Too many share password attempts; try again later");
    }
}
