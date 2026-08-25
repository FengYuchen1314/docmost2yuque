package io.knowledge.platform.authentication;

public final class EmailChallengeInvalidException extends RuntimeException {

    private static final long serialVersionUID = 1L;

    public EmailChallengeInvalidException() {
        super("The email verification code is invalid or expired");
    }
}
