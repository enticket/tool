# 엔티켓 도구 이전

## 실제 배포 상태 (2026-10-14)

통합 버전을 기존 Worker에 배포했습니다: https://enticket-drive.enticketai.workers.dev/
버전: `c435540f-00fd-4809-bdc4-00abba7856c5`. 기존 원격 코드와 설정은 `cloudflare/.private/remote-before-*`에 비공개로 백업했습니다. 기존 비밀 설정 이름/종류와 직원 허용목록 유지, 직인 시크릿 3개 등록을 확인했습니다. 공개 화면·healthz·비공개 경로 404·무인증 및 비허용 출처 API 거부를 실서비스에서 확인했습니다.

허용 계정도 거부되는 문제를 수정해 재배포했습니다. Workers에서 지원하지 않는 `fetch`의 `redirect: 'error'` 때문에 Google 검증 요청 전에 예외가 발생했습니다. `manual`로 바꾸고 3xx 응답은 직접 거부하여 인증 정보를 다른 주소로 전달하지 않습니다. 화면도 실제 `not_allowed` 응답만 허용목록 거부로 표시하고, 서버·연결·인증 오류는 구분해 안내하며 로그인 상태를 초기화합니다. 배포 후 두 Worker 주소에서 합성 무효 토큰이 기존 502 대신 정상적인 401 `invalid_token`으로 거부되는 것과 수정된 화면 제공을 확인했습니다. 기존 허용 계정 4개와 비밀 설정 이름도 유지됐습니다. 실제 직원 계정 로그인 성공 여부는 사용자 재확인이 필요합니다.

`tools.enticket.kr` Custom Domain 등록과 공개 DNS의 Cloudflare IP 응답을 확인했습니다. 등록 직후 잠시 TLS 오류가 있었지만 이후 HTTPS 화면 및 `/healthz` 200, 비공개 파일 404, 무인증 API 거부를 확인했습니다. 회사 홈페이지 두 주소는 HTTPS 200 응답을 유지합니다.

Google OAuth의 새 origin 등록 여부, 사용자 실제 로그인/Drive 저장은 아직 미검증입니다. `enticket.kr` DNS가 Cloudflare에서 활성화됐고 `tools.enticket.kr`을 기존 Worker에 Custom Domain으로 연결했습니다. 네임서버는 `clarissa.ns.cloudflare.com`, `dexter.ns.cloudflare.com`입니다. 회사 홈페이지는 기존 Netlify 연결을 유지합니다. GitHub Pages의 새 주소 안내/리디렉션은 아직 수행하지 않았습니다. 이번 GitHub 변경은 아래의 임시 local 모드를 반영합니다.

## 현재 구현

- GitHub Pages용 루트 `index.html`은 `local` 모드입니다. 명단·이미지·정산서 다운로드를 유지하고 로그인/Drive 저장은 숨깁니다. 원본대조필은 사용자가 직접 선택한 직인을 메모리에서만 사용합니다.
- Cloudflare 빌드는 같은 HTML을 `cloud` 모드로 복사합니다. 기존 `enticket-drive` Worker가 화면과 `/api/verify`, `/api/upload`, `/api/stamp`를 함께 제공합니다.
- 이전 화면과의 호환을 위해 `/verify`, `/upload`, `/stamp`도 유지합니다. 기존 Worker 주소는 그대로이고 `/`는 이제 도구 화면, 상태 확인은 `/healthz`입니다.
- 정적 파일은 Workers Assets가 제공하고 지정한 API 경로만 서버 코드를 실행합니다. DB나 유료 스토리지는 추가하지 않습니다.
- 기존 Google 앱의 직원 토큰 검증 → 이메일 허용목록 확인 → 회사 refresh token으로 Drive 저장하는 방식을 유지합니다. 메일 관련 기능은 제공된 원본에서도 제거된 상태이므로 다시 추가하지 않습니다.
- 회사 직인은 원본 코드에서 추출해 `cloudflare/.private/stamp-base64.txt`에 보관했습니다. 공개 코드에는 포함하지 않고 새 Worker secret `STAMP_JPEG_B64_1`, `STAMP_JPEG_B64_2`, `STAMP_JPEG_B64_3`로 전달합니다. 원본 복구용 코드도 같은 ignored 디렉터리에 보존했습니다.

## 로컬 실행과 확인

```sh
# 저장소 루트: GitHub 임시 버전, 오직 index.html만 서빙
python3 scripts/serve-local.py
# 별도 터미널; Python Playwright, Chromium 필요
python3 tests/browser-smoke.py

# Cloudflare 통합 버전
cd cloudflare
npm ci --cache /tmp/enticket-npm-cache
npm test
npm run check  # 공개 배포 없이 빌드와 Wrangler dry-run
npm run dev    # 127.0.0.1:8787
# 저장소 루트의 별도 터미널
python3 tests/cloud-browser.py
```

클라우드 개발 환경에서는 Wrangler 명령 앞에 `WRANGLER_SEND_METRICS=false XDG_CONFIG_HOME=/tmp/enticket-cloudflare-config`를 지정합니다. 기본 `Request.cf` 메타데이터의 외부 조회가 차단될 수 있지만 이 앱은 사용하지 않습니다. Wrangler 4.150.0과 호환 날짜 2026-10-13을 고정했습니다.

`browser-smoke.py`는 합성 파일의 XLSX/TXT/JPEG, 정산서 지급금액, 직인 XLSX/PDF, 직인 삭제/새로고침, 모바일 폭, 백엔드 호출 0건을 확인합니다. `cloud-browser.py`는 **모의 Google/API 응답**으로 로그인·세 종류 Drive 버튼·직인·만료/거부 계정을 확인합니다. Worker 테스트도 **모의 Google**을 사용하며 실제 Drive에 파일을 쓰지 않습니다. 실제 Google 연동 검증과 구분해야 합니다.

빌드는 `dist/index.html`, `dist/_headers`만 만듭니다. 예상하지 못한 파일이 있으면 중단합니다. 서버 앱, 사용자 데이터, `.env`, 직인은 공개 파일에 포함되지 않습니다. 저장소 전체를 HTTP 또는 정적 사이트로 배포하지 마세요. 로컬 GitHub 버전 빌드는 `python3 scripts/build-static.py --mode local`입니다.

## 기존 Cloudflare 설정 유지

`wrangler.jsonc`의 이름은 기존 **enticket-drive**입니다. 같은 계정에 배포해야 기존 secrets를 사용할 수 있습니다. `keep_vars: true`는 대시보드에서 설정한 `ALLOWED_EMAILS` 등의 일반 변수를 유지합니다. 기존 secrets도 별도 삭제/교체 없이 유지됩니다. 계정이 다른 새 Worker에 자동 복사되는 것은 아닙니다.

| 이름 | 배포 시 처리 |
| --- | --- |
| GOOGLE_CLIENT_ID | 기존 secret 유지. HTML의 공개 OAuth client ID와 일치해야 함 |
| GOOGLE_CLIENT_SECRET | 기존 secret 유지 |
| GOOGLE_REFRESH_TOKEN | 기존 secret 유지 |
| ALLOWED_EMAILS | 기존 일반 변수 유지 |
| STAMP_JPEG_B64_1 / STAMP_JPEG_B64_2 / STAMP_JPEG_B64_3 | 원본 직인을 3개 secret으로 나눠 추가 (각 값 5KB 제한) |
| MAIL_PUBLISH_KEY / ROUTINE_ID / ROUTINE_TOKEN | 기존 설정을 삭제하지 않음. 현재 코드에서는 사용 안 함 |
| ALLOWED_ORIGINS | 선택 사항. 기본은 요청 사이트 자체와 `https://enticket.github.io`. 추가 출처만 쉼표로 지정 |

## 배포 절차와 남은 설정

Cloudflare 계정 인증을 환경 설정으로 받아 아래 1~4단계의 배포를 완료했습니다. 기존 Google 비밀값은 재입력하지 않았습니다. 7단계의 DNS 전환과 Custom Domain 등록도 완료했습니다. Google 설정·사용자 검증·GitHub 이전 안내는 남아 있습니다.

1. Cloudflare 인증이 가능한 터미널에서 같은 계정인지 확인합니다 (`npx wrangler whoami`). 필요한 경우 그 터미널에서 `npx wrangler login`을 사용합니다.
2. 기존 변수/비밀 **이름**을 대시보드에서 확인하고 원본 Worker 버전을 보존합니다. 시크릿 값은 출력하거나 Git에 올리지 않습니다.
3. `cloudflare` 디렉터리에서 `npm run configure-stamp`를 실행해 비공개 파일을 `STAMP_JPEG_B64_1`, `STAMP_JPEG_B64_2`, `STAMP_JPEG_B64_3` secret으로 올립니다. 이 명령은 실제 계정 설정 변경입니다. 비공개 파일은 다른 체크아웃에 자동 복원되지 않으며, 없으면 원본 Worker에서 직접 추출해야 합니다. 이 스크립트가 직인을 3개 값으로 나눠 한 번에 등록합니다. 이미지 품질은 바뀌지 않습니다.
4. `npm run deploy`로 같은 `enticket-drive`에 배포합니다. **기존 실서비스 코드를 교체**하는 명령입니다. `npm run check`는 배포하지 않습니다. 새 화면 주소는 기존 Worker 주소 `https://enticket-drive.enticketai.workers.dev/`입니다.
5. Google Cloud Console에서 기존 OAuth 앱의 허용 JavaScript origin에 해당 Worker 주소를 등록합니다. `https://enticket.github.io`는 이전 화면 검증이 끝날 때까지 유지합니다. 이 앱은 GIS 팝업 방식을 쓰므로 이 단계에서 별도 callback URL은 추가하지 않습니다.
6. 새 사이트에서 허용/거부 계정, 각 종류 Drive 저장, 직인 XLSX/PDF를 실제 확인합니다. Google 토큰과 회사 Drive 권한의 현재 유효성은 아직 검증하지 못했습니다.
7. 회사 메인 홈페이지는 유지하고 `tools.enticket.kr` 같은 서브도메인을 Worker의 Custom Domain으로 연결합니다. 기존 DNS 충돌을 확인하고 Google 허용 origin에도 추가합니다. 현재 `tools.enticket.kr` 연결을 등록했습니다. Google 허용 JavaScript origin에 `https://tools.enticket.kr`도 추가해야 합니다.
8. 실제 사용을 확인한 후 GitHub Pages에서 새 주소로 안내합니다. GitHub Pages나 기존 Google origin 삭제는 마지막에 판단합니다.

Cloudflare Git 연동을 사용할 경우 저장소 루트에서 빌드 명령 `npm ci --prefix cloudflare && npm --prefix cloudflare run build`, 배포 명령 `npm --prefix cloudflare run deploy`를 사용합니다. 기존 프로젝트가 대시보드에만 있을 수 있으므로 연동은 별도 확인이 필요합니다. 기존 Worker 공개 배포는 완료했습니다. GitHub에는 임시 화면과 통합 Worker 소스를 함께 관리합니다. DNS 관리가 Cloudflare로 전환됐고, `tools.enticket.kr`이 연결됐습니다.

## 동작 보완 및 한계

- 원본 PDF 변환의 OKLCH 색상 오류는 임시 렌더 문서에서 앱 테마를 제거해 수정했습니다.
- API 응답은 `no-store`이며 비허용 출처는 거부합니다. 권한은 Origin과 별개로 모든 API에서 Google 검증+이메일 허용목록으로 검사합니다.
- 제공된 원본의 토큰 일부/길이 및 Google 원문 오류를 반환하던 진단은 제거했습니다. 오류 코드만 반환합니다.
- 폴더 조회·생성 실패 시 업로드를 중단합니다. 최대 파일 10MiB, 요청 11MiB, 폴더 깊이 8단계입니다. 정상 UI의 최대 4단계 경로를 지원합니다. 큰 파일은 로컬 다운로드를 사용합니다.
- 네트워크 오류 이후 자동 재업로드는 하지 않습니다. 응답을 받지 못했더라도 Drive에는 저장됐을 수 있으니 다시 저장하기 전에 Drive를 확인해야 합니다. 기존 폴더 생성은 동시 요청 시 중복될 가능성이 있으며 이번 이관에서 분산 잠금은 추가하지 않았습니다.
- 사용량 무료 한도 및 실제 CPU 시간은 운영 계정에서 확인해야 합니다. 로컬 테스트가 무료 한도 내 실행을 보장하지는 않습니다.

2026-10-14 검증: Worker 및 직인 분할 21개 테스트 통과. 추가한 workerd 회귀 테스트는 실제 Workers 런타임과 모의 Google 응답으로 허용/거부 계정, 무효 토큰, 리디렉션 차단을 확인합니다. Cloudflare 화면의 모의 연동 테스트는 서버·연결·인증 오류 메시지와 재로그인도 검증합니다. 배포 dry-run 및 배포 후 무효 토큰 응답 검증을 통과했습니다. 앞서 GitHub 임시 버전 브라우저 테스트, 로컬 Workers 화면/healthz와 비공개 파일 404도 확인했습니다. 실제 Google 로그인·Drive 쓰기는 미검증입니다.
