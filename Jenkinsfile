pipeline {
    agent { label 'flutter-linux' }

    environment {
        FLUTTER_SUPPRESS_ANALYTICS = 'true'
        DART_SUPPRESS_ANALYTICS = 'true'
    }

    options {
        skipDefaultCheckout()
        timeout(time: 25, unit: 'MINUTES')
        disableConcurrentBuilds()
    }

    stages {
        stage('Obtener código') {
            steps {
                deleteDir()
                checkout scm
                script {
                    env.FLUTTER_SOURCE = sh(
                        script: 'bash ci/flutter-source.sh',
                        returnStdout: true
                    ).trim()
                }
            }
        }
        stage('Compilar Flutter Web') {
            steps {
                dir(env.FLUTTER_SOURCE) {
                    sh '''
                        set -eu
                        flutter --version --machine | grep -Eq '"frameworkVersion":[[:space:]]*"3[.]50[.]0"'
                        flutter pub get --enforce-lockfile
                        flutter build web --release --no-pub
                    '''
                }
                archiveArtifacts artifacts: "${env.FLUTTER_SOURCE}/build/web/**", fingerprint: true
            }
        }
    }

    post {
        success {
            slackSend(channel: '#dev-github', color: 'good',
                message: "Academix: build Flutter Web exitosa. ${env.BUILD_URL}")
        }
        failure {
            slackSend(channel: '#dev-github', color: 'danger',
                message: "Academix: falló la build Flutter Web. ${env.BUILD_URL}")
        }
    }
}
