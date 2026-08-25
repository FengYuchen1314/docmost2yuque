package io.knowledge.platform.mail;

public record OutboundEmail(String recipient, String subject, String plainTextBody) {}
