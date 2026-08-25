package io.knowledge.platform.integration;

public final class OpenPlatformScopeException extends RuntimeException {private static final long serialVersionUID=1L;public OpenPlatformScopeException(String scope){super("Credential is missing required scope: "+scope);}}
