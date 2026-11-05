# Instagram 연동 (2026-11-05)

## 실제 확인한 범위

- 기준: `origin/main`의 `ee5a8e4`. 작업 시작 시 fetch로 최신 상태를 확인했습니다.
- 새 Cloudflare **계정 API 토큰**은 `/accounts/{account_id}/tokens/verify`에서 `active`, Worker 설정 조회에서 성공했습니다. 환경 상태의 설정 revision은 새 세션 기준 `1`로 보고됐습니다. 이전 세션 revision `12`와 직접 비교하지 않습니다.
- `INSTAGRAM_ACCESS_TOKEN`은 `secret_text`, `INSTAGRAM_ACCOUNT_ID`는 `plain_text`로 존재합니다. 비밀값은 조회·출력·복사하지 않았습니다.
- 기존 Worker의 두 설정을 상속한 **edge preview**에서 실제 Meta 조회를 실행했습니다. `graph.facebook.com/v27.0/17841465620686597?fields=id,username`이 200을 반환했고, ID와 사용자명 `en__ticket`이 일치했습니다. `/me/assigned_instagram_accounts?fields=id,username`에서도 같은 계정을 확인했습니다. 이 진단 코드는 운영 코드의 인증 우회 경로로 배포하지 않았습니다.
- 위 검증은 **계정 읽기와 토큰 연결 확인**입니다. 게시 권한의 실제 실행, 이미지 수집, 실제 피드/스토리 게시 성공은 사용자 확인 전입니다. 이 작업에서는 실제 계정에 컨테이너나 게시물을 생성하지 않았습니다.
- Google 로그인은 기존 사용자 확인 결과를 유지합니다. 실제 Drive 저장은 여전히 사용자 확인 전입니다. 직인 기능과 미추적 `instagram-admin/` 로컬 초안은 수정하지 않았습니다.

## 공식 문서 확인

Unified login은 기존 Instagram Login 방식과 다릅니다. `graph.facebook.com`과 `instagram_basic` / `instagram_content_publish` 권한을 사용합니다. `/me`는 Instagram 계정이 아니라 비즈니스 통합 시스템 사용자이므로, 서버에 고정된 Instagram ID를 직접 조회합니다. 구성 ID `1098623832997768`은 OAuth 로그인 구성 식별자이며 API 계정 ID나 토큰이 아닙니다.

2026-11-05에 확인한 공식 문서:

- [Unified Login 개요](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-unified-login) (2026-10-13 갱신)
- [시작하기](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-unified-login/get-started) (2026-10-27 갱신)
- [인증과 액세스 토큰](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-unified-login/authentication)
- [권한](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-unified-login/permissions)
- [콘텐츠 게시](https://developers.facebook.com/documentation/instagram-platform/content-publishing)
- [미디어 요구사항](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/media)
- [Cloudflare Durable Objects 무료 플랜](https://developers.cloudflare.com/durable-objects/platform/pricing/)

문서의 현재 예시 버전인 `v27.0`을 코드에 고정했고, 실제 계정 조회에서도 성공했습니다. Unified Login의 계정 조회에는 `id,username`을 사용합니다. Instagram Login 문서의 `account_type` 필드를 같이 요청했을 때는 실제 API가 code 100으로 거부했습니다. 따라서 계정 유형을 추측하여 표시하거나 저장하지 않습니다.

OAuth 콜백과 Webhook 수신 서버는 구현하지 않았고 Meta에 임의 주소도 등록하지 않았습니다. 현재 단일 회사 계정은 이미 저장된 서버 토큰을 사용합니다. 토큰 만료·철회 시 Meta에서 재발급해 동일 Worker secret을 교체할 수 있습니다. Unified Login 토큰의 만료는 구성에 따라 다르므로 기존 Instagram Login의 60일 갱신 규칙을 적용하지 않습니다.

## 제공하는 흐름

1. 운영 사이트의 **Instagram** 탭에서 기존 Google 허용 계정으로 로그인합니다.
2. **Instagram 연결 확인**으로 서버에 고정된 계정을 조회합니다. 연결 확인 시각은 한국 시간으로 표시합니다.
3. JPEG/PNG/WebP 포스터(최대 15MiB, 4천만 픽셀)를 선택합니다. 전체 보기/화면 채우기, 배경색, 확대, 위치, 이미지 문구와 피드 캡션을 편집합니다.
4. 브라우저에서 피드 1080×1350 또는 스토리 1080×1920 JPEG를 렌더링합니다. 미리보기·JPEG 다운로드·서버 전송은 동일한 JPEG 바이트를 사용합니다. 스토리에 피드 캡션은 전송하지 않습니다.
5. **게시 전 최종 확인**을 누르면 게시용 JPEG(최대 4MiB)와 내용을 서버에 고정합니다. 여기까지는 Meta에 이미지를 보내거나 게시하지 않습니다. Google 토큰은 이 저장소에 전달하지 않습니다.
6. 계정·게시 위치·이미지·문구를 확인하고 체크한 뒤 **확인한 내용 지금 게시**를 누르면 미디어 생성 → 상태 조회 → 게시를 진행합니다. 처리 중이면 같은 초안의 **게시 처리 계속**으로 이어갑니다.
7. 응답이 불명확하면 자동 재게시를 하지 않습니다. **마지막 게시 상태 확인**으로 원격 컨테이너가 `PUBLISHED`인지 조회하고, Instagram에서도 확인합니다. 재조회로 게시 완료가 확인되어도 게시물 ID를 확정할 수 없으면 ID 없이 완료로 표시합니다.

단일 이미지의 즉시 게시만 지원합니다. 동영상·캐러셀·예약·링크/음악/위치 스티커·자동 토큰 갱신은 구현하지 않았습니다. 앱의 미리보기는 Instagram 앱 화면의 UI 크롭을 재현하지 않습니다. 최초 실게시의 내용은 운영자가 확인해야 합니다.

## 인증·보관·중복 처리

- `/api/instagram/connection`, `/prepare`, `/publish`, `/status`는 모두 기존 Google audience/만료/이메일 인증/허용목록 및 출처 검사를 통과해야 합니다. Instagram 비밀은 Worker 환경에만 있으며 브라우저나 API 응답에 포함하지 않습니다.
- `InstagramJob`은 초안 UUID마다 하나인 SQLite 기반 Durable Object입니다. `INSTAGRAM_JOBS` 바인딩과 `instagram-v1` 마이그레이션으로 생성합니다. Cloudflare Workers Free에서 지원하며 유료 플랜 전환이나 별도 유료 서버를 요구하지 않습니다. 실제 계정의 무료 한도와 공용 Worker 사용량은 따로 적용됩니다.
- JPEG·계정 ID·게시 위치·캡션의 SHA-256 지문을 확인 요청과 대조합니다. 최초 저장한 내용은 변경할 수 없고 새로 편집하려면 새 초안을 준비해야 합니다. 거래적 상태 변경으로 같은 초안의 동시/반복 요청을 합칩니다.
- 게시 호출 직전에 `posting`을 영구 저장합니다. 응답 유실/실행 중단 후에는 `unknown`으로 다루고 게시 API를 재호출하지 않습니다. 그 이전 처리 실패는 `failed`이며 같은 초안의 게시를 재시도하지 않습니다.
- 게시용 JPEG만 `/instagram-media/{draftUUID}/{임의키}`로 최대 24시간 제공합니다. 이 주소를 아는 사람은 만료 전 이미지에 접근할 수 있습니다. 원본 포스터는 업로드하지 않습니다. 임의키/토큰/외부 오류 원문을 로그에 출력하지 않습니다.
- 알람이 게시 이미지를 만료 후 삭제하고, 작은 초안/게시 상태 기록은 총 30일 뒤 삭제합니다. 계정이 바뀌면 이전 초안의 게시·상태 API를 차단합니다.
- 브라우저에는 마지막 초안 ID만 localStorage에 남깁니다. 새로고침 후 상태 조회를 지원하지만 이미지·캡션을 복원해 게시를 재개하지는 않습니다. 로그아웃하면 화면의 이미지·캡션을 지웁니다.

## 검증

```sh
cd cloudflare
npm test
WRANGLER_SEND_METRICS=false XDG_CONFIG_HOME=/tmp/enticket-cloudflare-config npm run check
WRANGLER_SEND_METRICS=false XDG_CONFIG_HOME=/tmp/enticket-cloudflare-config npm run dev
# 다른 터미널, 저장소 루트
python tests/instagram-browser.py
python tests/cloud-browser.py
```

Worker 테스트는 인증 거부, 오류/리디렉션의 비밀 차단과 실제 workerd+SQLite 저장소에서 최종 확인 누락·내용 변경·미디어 URL 권한·동시/반복 게시·응답 유실·원격 완료 재조회를 검증합니다. 브라우저 테스트는 실제 JPEG 렌더링과 전송 바이트 일치, 확인 전 미게시, 피드/스토리, 로그아웃, 비허용 계정 및 모바일 폭을 확인합니다. 외부 Google/Meta 응답은 모의 처리하므로 실제 게시 검증과 구분합니다.

검증 결과: Worker 테스트 30개 통과, Instagram 브라우저 흐름 통과, 기존 cloud-browser 회귀 통과, Wrangler 배포 dry-run 통과. 브라우저·게시 테스트의 Meta/Google 응답은 합성입니다.

## 운영 반영 기록

- 운영 주소: https://tools.enticket.kr/
- Worker: `enticket-drive`, 초기 기능 배포 버전 `e7452154-e02f-4c15-a2b2-061154130c51`.
- 배포 코드: `08a529e` (후속 문서 커밋은 실행 코드에 영향 없음).
- [초안 PR #1](https://github.com/enticket/tool/pull/1), 브랜치 `codex/instagram-unified-integration`. `main`에는 아직 병합하지 않았습니다. 운영 배포는 이 브랜치의 코드를 사용합니다.
- 운영 화면/healthz 200, 무효 Google 토큰 401, 비허용 출처 403, 서버 소스/로컬 초안 비밀 경로 404를 확인했습니다. 배포 전후 모든 기존 바인딩의 이름/유형을 비교해 보존을 확인했고 `INSTAGRAM_JOBS`만 추가됐습니다. 유료 플랜 변경은 하지 않았습니다.
- 실제 연결 확인 함수도 기존 비밀을 상속한 edge preview에서 다시 실행해 `en__ticket`과 고정 ID가 일치함을 확인했습니다. 운영 API의 Google 인증을 우회하는 경로는 없습니다.
- 브라우저가 게시 응답을 잃는 경우도 모의 검증했습니다. 화면은 게시 결과를 `unknown`으로 잠그고, 상태 재조회로만 결과를 갱신합니다.

2026-11-05 화면 표시 보완: 로그인 버튼을 상단으로 이동하고 `Google 로그인`으로 표시했습니다. 모바일 메뉴는 줄바꿈하여 Instagram 항목도 가로 스크롤 없이 보입니다. 클라우드 빌드는 최초 HTML에서 로그인·Instagram 메뉴의 `hidden`을 제거합니다. 기존 로그인 회귀 테스트와 1440/390/320px 화면의 버튼·메뉴 표시를 확인했습니다. 배포 코드 `177276e`, Worker 버전 `c1cd18bf-d671-4c0a-8c86-62a6f4da39ba`. 사용자에게서 두 항목이 모두 안 보이는 접속 상태 자체는 재현하지 못했으며, 접속 URL 확인을 요청했습니다. 새로 확인할 주소는 https://tools.enticket.kr/?v=20261105-login 입니다.

사용자의 추가 설명으로 로그인·Instagram 메뉴가 없던 화면은 운영 주소가 아닌 로컬용 `index.html`이었음을 확인했습니다. 이후 사용자 요청에 따라 로그인 위치를 원래의 데스크톱 왼쪽 하단·모바일 오른쪽 상단으로 복구했습니다. Worker 배포 버전은 `ed5beb16-4ddd-49b8-b6a2-11c00a46f548`이며, 1440/390/320px 브라우저 배치와 운영 HTML 반영을 확인했습니다.

2026-11-05 인스타그램 화면 정리: 메뉴·제목·안내/오류 문구를 `인스타그램`으로 통일하고, 기존 업무 도구의 보라색·카드·입력 필드·상태 색상 토큰에 맞췄습니다. 계정 연결 카드, 이미지 준비/미리보기/최종 확인 단계, 파일 드롭 영역과 파일명, 접이식 확대·위치 조정/초기화, 캡션 글자 수 및 게시 규격 안내를 추가했습니다. 로그인 위치는 기존 배치를 유지합니다. 모의 API를 사용한 기존 게시 확인/응답 유실 회귀, 드래그 드롭/초기화, 모바일·다크 모드 화면을 검증했습니다. Worker 배포 버전 `edd5d0d5-8b1a-4ed6-b1a9-53e73a5dae9b`; 운영 HTML의 한글 메뉴와 새 카드 제공도 확인했습니다. 실제 인스타그램 게시는 실행하지 않았습니다.

인스타그램 편집기의 배경색 옆에 `흐린 배경` 체크박스를 제공합니다. 별도의 여백 배경 선택 메뉴는 제거했습니다. 확대·블러 처리한 배경 위에 선명한 원본을 전체 보기로 배치하며, 양옆 최소 여백을 0~20%로 조절합니다. 흐린 배경 체크박스는 기본으로 켜져 있으며, 기본 상하 위치에서는 선명한 원본을 캔버스 하단에 맞춰 아래쪽 외부 여백이 생기지 않도록 배치합니다. 합성 포스터의 여백 픽셀과 최종 JPEG 전송 바이트, 기존 게시 확인 흐름을 모의 API로 검증했습니다.
