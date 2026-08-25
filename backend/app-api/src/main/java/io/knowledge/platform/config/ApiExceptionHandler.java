package io.knowledge.platform.config;

import io.knowledge.platform.setup.InstanceAlreadyInitializedException;
import io.knowledge.platform.setup.SmtpNotReadyException;
import io.knowledge.platform.identity.InvalidCredentialsException;
import io.knowledge.platform.authentication.AuthenticationRateLimitedException;
import io.knowledge.platform.authentication.PasswordAuthenticationRateLimitedException;
import io.knowledge.platform.authentication.EmailChallengeInvalidException;
import io.knowledge.platform.authentication.EmailCodeLoginDisabledException;
import io.knowledge.platform.authentication.RegistrationClosedException;
import io.knowledge.platform.invitation.InvitationInvalidException;
import io.knowledge.platform.mail.MailUnavailableException;
import io.knowledge.platform.authorization.AuthorizationDeniedException;
import io.knowledge.platform.authorization.ResourceNotFoundException;
import io.knowledge.platform.common.DomainConflictException;
import io.knowledge.platform.share.ShareInvalidException;
import io.knowledge.platform.share.SharePasswordInvalidException;
import io.knowledge.platform.share.ShareRateLimitedException;
import io.knowledge.platform.integration.OpenPlatformScopeException;
import io.knowledge.platform.integration.OpenPlatformTokenReuseException;
import io.knowledge.platform.publication.DatabaseFormRateLimitedException;
import java.net.URI;
import java.util.stream.Collectors;
import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

@RestControllerAdvice
class ApiExceptionHandler {

    @ExceptionHandler(DatabaseFormRateLimitedException.class)
    ResponseEntity<ProblemDetail> databaseFormRateLimited(
            DatabaseFormRateLimitedException exception) {
        ProblemDetail problem = problem(
                HttpStatus.TOO_MANY_REQUESTS,
                "DATABASE_FORM_RATE_LIMITED",
                exception.getMessage());
        return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS)
                .header("Retry-After", "3600")
                .body(problem);
    }

    @ExceptionHandler(OpenPlatformScopeException.class)
    ResponseEntity<ProblemDetail> openPlatformScope(OpenPlatformScopeException exception) {
        return ResponseEntity.status(HttpStatus.FORBIDDEN)
                .body(problem(HttpStatus.FORBIDDEN, "API_SCOPE_DENIED", exception.getMessage()));
    }

    @ExceptionHandler(OpenPlatformTokenReuseException.class)
    ResponseEntity<ProblemDetail> tokenReuse(OpenPlatformTokenReuseException exception) {
        return ResponseEntity.badRequest()
                .body(problem(HttpStatus.BAD_REQUEST, "OAUTH_REFRESH_REUSE", exception.getMessage()));
    }

    @ExceptionHandler(ShareRateLimitedException.class)
    ResponseEntity<ProblemDetail> shareRateLimited(ShareRateLimitedException exception) {
        ProblemDetail problem = problem(
                HttpStatus.TOO_MANY_REQUESTS,
                "SHARE_RATE_LIMITED",
                exception.getMessage());
        return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS)
                .header("Retry-After", "3600")
                .body(problem);
    }

    @ExceptionHandler(SharePasswordInvalidException.class)
    ResponseEntity<ProblemDetail> sharePasswordInvalid(
            SharePasswordInvalidException exception) {
        ProblemDetail problem = problem(
                HttpStatus.UNAUTHORIZED,
                "SHARE_PASSWORD_INVALID",
                exception.getMessage());
        return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(problem);
    }

    @ExceptionHandler(ShareInvalidException.class)
    ResponseEntity<ProblemDetail> shareInvalid(ShareInvalidException exception) {
        ProblemDetail problem = problem(
                HttpStatus.GONE,
                "SHARE_INVALID",
                exception.getMessage());
        return ResponseEntity.status(HttpStatus.GONE).body(problem);
    }

    @ExceptionHandler(AuthorizationDeniedException.class)
    ResponseEntity<ProblemDetail> authorizationDenied(AuthorizationDeniedException exception) {
        ProblemDetail problem = problem(
                HttpStatus.FORBIDDEN,
                "AUTHORIZATION_DENIED",
                exception.getMessage());
        return ResponseEntity.status(HttpStatus.FORBIDDEN).body(problem);
    }

    @ExceptionHandler(ResourceNotFoundException.class)
    ResponseEntity<ProblemDetail> resourceNotFound(ResourceNotFoundException exception) {
        ProblemDetail problem = problem(
                HttpStatus.NOT_FOUND,
                "RESOURCE_NOT_FOUND",
                exception.getMessage());
        return ResponseEntity.status(HttpStatus.NOT_FOUND).body(problem);
    }

    @ExceptionHandler(DomainConflictException.class)
    ResponseEntity<ProblemDetail> domainConflict(DomainConflictException exception) {
        ProblemDetail problem = problem(
                HttpStatus.CONFLICT,
                exception.code(),
                exception.getMessage());
        return ResponseEntity.status(HttpStatus.CONFLICT).body(problem);
    }

    @ExceptionHandler(AuthenticationRateLimitedException.class)
    ResponseEntity<ProblemDetail> authenticationRateLimited(
            AuthenticationRateLimitedException exception) {
        ProblemDetail problem = problem(
                HttpStatus.TOO_MANY_REQUESTS,
                "AUTH_RATE_LIMITED",
                exception.getMessage());
        return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS)
                .header("Retry-After", "3600")
                .body(problem);
    }

    @ExceptionHandler(PasswordAuthenticationRateLimitedException.class)
    ResponseEntity<ProblemDetail> passwordAuthenticationRateLimited(
            PasswordAuthenticationRateLimitedException exception) {
        ProblemDetail problem = problem(
                HttpStatus.TOO_MANY_REQUESTS,
                "PASSWORD_LOGIN_RATE_LIMITED",
                exception.getMessage());
        return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS)
                .header("Retry-After", "900")
                .body(problem);
    }

    @ExceptionHandler(EmailChallengeInvalidException.class)
    ResponseEntity<ProblemDetail> emailChallengeInvalid(
            EmailChallengeInvalidException exception) {
        ProblemDetail problem = problem(
                HttpStatus.UNAUTHORIZED,
                "EMAIL_CHALLENGE_INVALID",
                exception.getMessage());
        return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(problem);
    }

    @ExceptionHandler(RegistrationClosedException.class)
    ResponseEntity<ProblemDetail> registrationClosed(
            RegistrationClosedException exception) {
        ProblemDetail problem = problem(
                HttpStatus.FORBIDDEN,
                "REGISTRATION_CLOSED",
                exception.getMessage());
        return ResponseEntity.status(HttpStatus.FORBIDDEN).body(problem);
    }

    @ExceptionHandler(EmailCodeLoginDisabledException.class)
    ResponseEntity<ProblemDetail> emailCodeLoginDisabled(
            EmailCodeLoginDisabledException exception) {
        ProblemDetail problem = problem(
                HttpStatus.UNPROCESSABLE_CONTENT,
                "AUTH_EMAIL_CODE_UNAVAILABLE",
                exception.getMessage());
        return ResponseEntity.status(HttpStatus.UNPROCESSABLE_CONTENT).body(problem);
    }

    @ExceptionHandler(InvalidCredentialsException.class)
    ResponseEntity<ProblemDetail> invalidCredentials(InvalidCredentialsException exception) {
        ProblemDetail problem = problem(
                HttpStatus.UNAUTHORIZED,
                "INVALID_CREDENTIALS",
                exception.getMessage());
        return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(problem);
    }

    @ExceptionHandler(InvitationInvalidException.class)
    ResponseEntity<ProblemDetail> invalidInvitation(InvitationInvalidException exception) {
        ProblemDetail problem = problem(
                HttpStatus.GONE,
                "INVITATION_INVALID",
                exception.getMessage());
        return ResponseEntity.status(HttpStatus.GONE).body(problem);
    }

    @ExceptionHandler(InstanceAlreadyInitializedException.class)
    ResponseEntity<ProblemDetail> instanceAlreadyInitialized(
            InstanceAlreadyInitializedException exception) {
        ProblemDetail problem = problem(
                HttpStatus.CONFLICT,
                "INSTANCE_ALREADY_INITIALIZED",
                exception.getMessage());
        return ResponseEntity.status(HttpStatus.CONFLICT).body(problem);
    }

    @ExceptionHandler(SmtpNotReadyException.class)
    ResponseEntity<ProblemDetail> smtpNotReady(SmtpNotReadyException exception) {
        ProblemDetail problem = problem(
                HttpStatus.UNPROCESSABLE_CONTENT,
                "SMTP_NOT_READY",
                exception.getMessage());
        return ResponseEntity.status(HttpStatus.UNPROCESSABLE_CONTENT).body(problem);
    }

    @ExceptionHandler(MailUnavailableException.class)
    ResponseEntity<ProblemDetail> mailUnavailable(MailUnavailableException exception) {
        ProblemDetail problem = problem(
                HttpStatus.UNPROCESSABLE_CONTENT,
                "SMTP_NOT_READY",
                exception.getMessage());
        return ResponseEntity.status(HttpStatus.UNPROCESSABLE_CONTENT).body(problem);
    }

    @ExceptionHandler(IllegalArgumentException.class)
    ResponseEntity<ProblemDetail> illegalArgument(IllegalArgumentException exception) {
        ProblemDetail problem =
                problem(HttpStatus.BAD_REQUEST, "INVALID_REQUEST", exception.getMessage());
        return ResponseEntity.badRequest().body(problem);
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    ResponseEntity<ProblemDetail> validation(MethodArgumentNotValidException exception) {
        String detail = exception.getBindingResult().getFieldErrors().stream()
                .map(error -> error.getField() + ": " + error.getDefaultMessage())
                .collect(Collectors.joining("; "));
        ProblemDetail problem = problem(HttpStatus.BAD_REQUEST, "VALIDATION_FAILED", detail);
        return ResponseEntity.badRequest().body(problem);
    }

    private static ProblemDetail problem(HttpStatus status, String code, String detail) {
        ProblemDetail problem = ProblemDetail.forStatusAndDetail(status, detail);
        problem.setTitle(status.getReasonPhrase());
        problem.setType(URI.create("https://errors.knowledge.local/" + code));
        problem.setProperty("code", code);
        return problem;
    }
}
