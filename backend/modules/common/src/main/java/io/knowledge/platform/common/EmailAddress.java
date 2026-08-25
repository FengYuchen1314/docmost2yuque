package io.knowledge.platform.common;

import java.util.Locale;
import java.util.Objects;
import java.util.regex.Pattern;

public record EmailAddress(String original, String normalized) {

    private static final Pattern BASIC_EMAIL =
            Pattern.compile("^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$");

    public EmailAddress {
        Objects.requireNonNull(original, "original");
        Objects.requireNonNull(normalized, "normalized");
    }

    public static EmailAddress parse(String value) {
        if (value == null) {
            throw new IllegalArgumentException("Email is required");
        }

        String trimmed = value.trim();
        if (trimmed.length() > 320 || !BASIC_EMAIL.matcher(trimmed).matches()) {
            throw new IllegalArgumentException("Email is invalid");
        }

        return new EmailAddress(trimmed, trimmed.toLowerCase(Locale.ROOT));
    }
}

