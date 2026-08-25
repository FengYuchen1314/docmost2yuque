package io.knowledge.platform.share;

public final class SharePasswordInvalidException extends RuntimeException {

    private static final long serialVersionUID = 1L;

    public SharePasswordInvalidException() {
        super("The share password is incorrect");
    }
}
