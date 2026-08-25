package io.knowledge.platform.setup;

public final class InstanceAlreadyInitializedException extends RuntimeException {

    private static final long serialVersionUID = 1L;

    public InstanceAlreadyInitializedException() {
        super("The instance has already been initialized");
    }
}
