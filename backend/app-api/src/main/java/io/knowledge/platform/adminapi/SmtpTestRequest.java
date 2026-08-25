package io.knowledge.platform.adminapi;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.Size;

record SmtpTestRequest(@Email @Size(max = 320) String recipient) {}
