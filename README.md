# 전자 기부금 영수증 서버
대한예수교장로회 전자 기부금 영수증을 교인으로 부터 편리하게 받는 방법을 만들려고 합니다.

## 기본 구조
GitHub Pages → HTTPS Cloud Function → Firestore.
신청자는 로그인하지 않으며, 관리자는 권한이 있는 Firebase 콘솔 계정으로 조회합니다.

## 개인정보 및 접근 제어
- Firestore에는 주민등록번호를 별도 필드 암호화 없이 저장합니다. Firestore 기본 저장 암호화는 적용되지만, 접근 권한이 있는 관리자는 원문을 볼 수 있습니다. 운영 전 개인정보 처리 및 법적 요건, 관리자 IAM 권한과 보관·삭제 정책을 확인하세요.
- 클라이언트의 Firestore 직접 읽기와 쓰기는 `firestore.rules`로 모두 차단합니다. 이 규칙을 배포하면 해당 데이터베이스의 다른 클라이언트 접근도 차단되므로 기존 서비스를 먼저 확인하세요. 서버 Admin SDK와 Firebase 콘솔에는 보안 규칙이 적용되지 않으므로 IAM 권한을 최소화해야 합니다.
- App Check 및 reCAPTCHA를 사용하지 않습니다. 허용된 웹 출처만 CORS로 허용하지만, CORS는 인증이 아니므로 외부 프로그램의 허위 신청이나 자동화 요청을 막지 못합니다. 운영 시 할당량과 비용을 감시하고 별도의 속도 제한 등 남용 방지 대책을 마련하세요. 신청 내용은 로그에 기록하지 않습니다.

## 설정 및 배포
1. Firebase 프로젝트에서 Firestore 데이터베이스를 생성합니다. Functions 배포에는 필요한 Firebase 권한과 요금제 설정이 필요합니다. App Check 또는 reCAPTCHA 키 등록은 필요하지 않습니다.
2. `functions/.env.example`을 `functions/.env`로 복사해 `ALLOWED_ORIGINS`에 실제 웹 출처를 쉼표로 구분하여 설정합니다. 출처는 경로 없이 `https://example.github.io` 형태이며, GitHub Pages 경로를 넣지 않습니다. 운영 사이트는 HTTPS를 사용하세요.
3. `functions` 디렉터리에서 `npm ci`를 실행합니다. Firebase CLI에서 올바른 프로젝트를 선택하고, 규칙 및 함수 배포 범위를 확인한 뒤 `firebase deploy --only firestore:rules,functions`를 실행합니다. 실제 배포는 별도 승인 후 수행합니다.
4. 배포된 `submitDonation` 함수 URL을 프런트의 `firebase-config.js`의 `functionUrl`에 입력합니다. 프런트는 Firebase SDK를 사용하지 않으며 기존 `firebaseConfig` 값은 전송에 사용되지 않습니다. 서비스 계정 키 등 비밀값을 넣지 마세요. 함수 URL이 비어 있으면 신청은 전송되지 않습니다.

## 기존 App Check 및 reCAPTCHA 설정 제거
- 코드 변경만으로 Firebase 콘솔 설정이나 배포된 함수가 변경되지는 않습니다. 먼저 변경된 Functions를 배포하고 웹 페이지를 배포합니다.
- Firebase App Check 콘솔에서 강제 적용한 서비스가 있다면 다른 앱의 사용 여부를 확인한 후 해제하고 웹 앱의 Enterprise 제공자 등록을 해제합니다. Firebase 웹 앱 자체를 삭제할 필요는 없습니다.
- 다른 서비스가 사용하지 않고 새 배포가 정상 작동하는 것을 확인한 후 Google Cloud Fraud Defense에서 해당 Enterprise 키를 삭제합니다. Firestore 보안 규칙과 관리자 IAM 접근 제한은 그대로 유지합니다.

## 저장 구조 및 재시도
- `donationApplications` 컬렉션에 무작위 요청 ID를 문서 ID로 사용합니다. 문서에는 `submission`(입력 내용), `recordName`(한국 시간 기준 `성함_YYYYMMDDHHmmss`), 서버 시각 `createdAt`이 저장됩니다. 별도 JSON 파일은 만들지 않습니다.
- 같은 화면에서 동일 내용으로 재시도하면 동일 요청 ID를 사용해 중복 저장을 방지합니다. 응답을 받지 못하면 실제 저장되었을 수 있으므로 새로고침이나 내용 수정 전에 재시도하세요. 새로고침 이후의 중복은 자동으로 방지하지 않습니다.

## 테스트
- `functions`에서 `npm test`로 단위 테스트를 실행합니다. 에뮬레이터 연동 테스트는 환경 변수가 없으면 건너뜁니다.
- Java와 Firebase CLI가 설치된 환경에서 프로젝트 루트에서 `firebase emulators:exec --project demo-church-gibu --only firestore "npm --prefix functions test"`를 실행하면 가상의 데이터로 Firestore 연동 및 직접 접근 차단을 검증합니다. 실제 배포 환경은 Firebase 프로젝트 설정 후 별도로 확인해야 합니다.

## 신청 데이터 JSON 내보내기
Google Cloud CLI를 설치하고 `gcloud auth login`으로 Firestore 읽기 권한(예: `roles/datastore.viewer`)이 있는 계정에 로그인한 뒤, 서버 프로젝트 루트의 PowerShell에서 실행합니다.

```powershell
.\Export-DonationApplications.ps1
```

- 기본 프로젝트는 `church-gibu-server`, 데이터베이스는 `(default)`입니다. 필요하면 `-ProjectId`, `-DatabaseId`, `-OutputPath`로 변경합니다. CLI가 PATH에 없으면 `-GcloudPath "C:\...\gcloud.cmd"`로 지정합니다.
- `donationApplications`의 모든 문서를 페이지 단위로 읽어 `exports\donationApplications-날짜시간.json`에 UTF-8로 저장합니다. 하위 컬렉션은 포함하지 않습니다.
- JSON에는 프로젝트 정보, 내보낸 시각, `documentCount`, `documents` 배열이 들어갑니다. 문서 ID를 포함한 전체 경로(`name`), 모든 필드(`fields`), 생성·수정 시각을 Firestore REST 형식 그대로 보존합니다. 예를 들어 신청자 이름은 `fields.submission.mapValue.fields.name.stringValue`에 있습니다.
- 빈 컬렉션은 `documents: []`로 저장하며, 조회 실패 시 부분 결과를 저장하지 않습니다. 기존 출력 파일은 덮어쓰지 않습니다. 조회 중 데이터가 변경되면 단일 시점의 백업과는 다를 수 있으며, 읽기 비용이 발생할 수 있습니다.
- **주민등록번호 등 개인정보 원문을 포함하는 파일입니다.** 기본 `exports` 폴더는 Git에서 제외합니다. 다른 경로로 저장할 경우에도 커밋하거나 공유하지 말고, 접근 제한된 로컬 위치에 보관 후 필요가 없어지면 삭제하세요. 이 스크립트는 데이터를 수정하거나 보안 규칙을 변경하지 않습니다.
