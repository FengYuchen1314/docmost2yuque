package io.knowledge.platform.identity;

public final class IdentityAlreadyExistsException extends RuntimeException {

    private static final long serialVersionUID = 1L;

    public IdentityAlreadyExistsException() {
        super("This email cannot be registered");
    }
}
