package io.knowledge.platform.identity;

public final class InvalidCredentialsException extends RuntimeException {

    private static final long serialVersionUID = 1L;

    public InvalidCredentialsException() {
        super("Email or password is incorrect");
    }
}
