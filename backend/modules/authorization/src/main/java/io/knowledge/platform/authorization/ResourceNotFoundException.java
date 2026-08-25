package io.knowledge.platform.authorization;

public final class ResourceNotFoundException extends RuntimeException {

    private static final long serialVersionUID = 1L;

    public ResourceNotFoundException() {
        super("The requested resource does not exist");
    }
}
