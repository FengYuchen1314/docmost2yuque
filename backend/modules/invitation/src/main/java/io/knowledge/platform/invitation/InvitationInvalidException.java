package io.knowledge.platform.invitation;

public final class InvitationInvalidException extends RuntimeException {

    private static final long serialVersionUID = 1L;

    public InvitationInvalidException() {
        super("Invitation is invalid, expired, accepted, or revoked");
    }
}
