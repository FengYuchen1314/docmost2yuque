package io.knowledge.platform.share;

public final class ShareInvalidException extends RuntimeException {

    private static final long serialVersionUID = 1L;

    public ShareInvalidException() {
        super("The share link is invalid, expired, or revoked");
    }
}
