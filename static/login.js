// 登录页 AJAX：成功跳转首页，失败按状态码显示错误；无 JS 时回退原生表单提交。
(function () {
  var form = document.getElementById('login-form');
  var errBox = document.getElementById('login-error');
  var btn = document.getElementById('login-btn');
  if (!form) return;

  function showError(msg) {
    errBox.textContent = msg;
    errBox.style.display = '';
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    errBox.style.display = 'none';
    btn.disabled = true;
    var origText = btn.textContent;
    btn.textContent = '登录中…';

    fetch('/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: form.username.value,
        password: form.password.value
      })
    }).then(function (res) {
      if (res.ok) { window.location.href = '/'; return null; }
      return res.json().catch(function () { return {}; }).then(function (data) {
        showError(data.error || '登录失败，请重试');
      });
    }).catch(function () {
      showError('网络错误，请重试');
    }).then(function () {
      if (window.location.pathname === '/login') {
        btn.disabled = false;
        btn.textContent = origText;
      }
    });
  });
})();
