package io.knowledge.platform.identity;

import org.springframework.stereotype.Component;

@Component
final class PasswordPolicy {

    private static final int MIN_LENGTH = 10;
    private static final int MAX_LENGTH = 128;

    void validate(String password) {
        if (password == null || password.length() < MIN_LENGTH || password.length() > MAX_LENGTH) {
            throw new IllegalArgumentException(
                    "Password must be between " + MIN_LENGTH + " and " + MAX_LENGTH + " characters");
        }
    }
}

