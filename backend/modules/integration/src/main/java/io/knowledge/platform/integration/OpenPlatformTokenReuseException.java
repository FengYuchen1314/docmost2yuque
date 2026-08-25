package io.knowledge.platform.integration;

public final class OpenPlatformTokenReuseException extends RuntimeException {private static final long serialVersionUID=1L;public OpenPlatformTokenReuseException(){super("Refresh token reuse detected; the token family was revoked");}}
