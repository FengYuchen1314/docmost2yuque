package io.knowledge.platform.authorization;

public final class AuthorizationDeniedException extends RuntimeException {

    private static final long serialVersionUID = 1L;

    public AuthorizationDeniedException() {
        super("The requested operation is not permitted");
    }
}
