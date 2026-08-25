package io.knowledge.platform.authentication;

public final class RegistrationClosedException extends RuntimeException {

    private static final long serialVersionUID = 1L;

    public RegistrationClosedException() {
        super("Public registration is closed");
    }
}
