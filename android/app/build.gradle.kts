plugins { id("com.android.application"); id("org.jetbrains.kotlin.android") version "2.0.21" }
android {
 namespace = "com.gunakarna.jazzrecovery"
 compileSdk = 35
 defaultConfig { applicationId = "com.gunakarna.jazzrecovery"; minSdk = 26; targetSdk = 35; versionCode = 1; versionName = "1.0.0" }
 compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
}
kotlin { jvmToolchain(17) }

dependencies {
 implementation("androidx.work:work-runtime-ktx:2.10.1")
}
