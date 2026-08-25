plugins {
    java
    `java-library`
    alias(libs.plugins.spring.dependency.management)
}

dependencyManagement {
    imports {
        mavenBom(org.springframework.boot.gradle.plugin.SpringBootPlugin.BOM_COORDINATES)
    }
}

dependencies {
    api(project(":modules:common"))
    implementation(project(":modules:identity"))
    implementation(project(":modules:jobs"))
    implementation(project(":modules:mail"))
    implementation(project(":modules:setup"))
    implementation(project(":modules:workspace"))
    implementation(libs.spring.context)
    implementation(libs.spring.security.crypto)
    implementation(libs.spring.tx)
    implementation(libs.jooq)

    testImplementation(libs.spring.boot.test)
}
