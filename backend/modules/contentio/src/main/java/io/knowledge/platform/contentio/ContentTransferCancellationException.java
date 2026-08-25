package io.knowledge.platform.contentio;

final class ContentTransferCancellationException extends RuntimeException {

    private static final long serialVersionUID = 1L;

    ContentTransferCancellationException() {
        super("Content transfer cancellation was requested");
    }
}
