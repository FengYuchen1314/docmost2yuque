plugins {
    java
    alias(libs.plugins.spring.boot)
    alias(libs.plugins.spring.dependency.management)
}

dependencies {
    implementation(project(":modules:common"))
    implementation(project(":modules:authentication"))
    implementation(project(":modules:jobs"))
    implementation(project(":modules:invitation"))
    implementation(project(":modules:mail"))
    implementation(project(":modules:publication"))
    implementation(libs.spring.boot.actuator)
    implementation(libs.spring.boot.jooq)
    implementation(libs.spring.security.crypto)
    implementation(libs.bouncycastle.provider)
    runtimeOnly(libs.postgresql)

    testImplementation(libs.spring.boot.test)
    testImplementation(libs.testcontainers.postgresql)
    testImplementation(libs.testcontainers.junit)
}

tasks.bootJar {
    archiveFileName = "knowledge-platform-worker.jar"
}
