var db = firebase.apps[0].firestore();
var auth = firebase.apps[0].auth();

let passwords = [];
let editingId = null;
let sessionMasterUnlocked = false;
let currentUserDocId = null;
let hasMasterPassword = false;
let masterChecked = false;

const MASTER_SECRET = 'CAMBIA_ESTA_CLAVE_LARGA_Y_UNICA_PARA_TU_PROYECTO';

// ====== Utilidades base64 / cifrado ======
function bytesToBase64(bytes) {
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

function base64ToBytes(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

async function deriveKey(saltBytes) {
    if (!window.crypto || !window.crypto.subtle) {
        throw new Error('Web Crypto API no soportada en este navegador');
    }

    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
        'raw',
        enc.encode(MASTER_SECRET),
        { name: 'PBKDF2' },
        false,
        ['deriveKey']
    );

    return crypto.subtle.deriveKey(
        {
            name: 'PBKDF2',
            salt: saltBytes,
            iterations: 100000,
            hash: 'SHA-256'
        },
        keyMaterial,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
    );
}

async function encryptPassword(plainText) {
    const enc = new TextEncoder();
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(salt);

    const cipherBuffer = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: iv },
        key,
        enc.encode(plainText)
    );

    return {
        cipherText: bytesToBase64(new Uint8Array(cipherBuffer)),
        iv: bytesToBase64(iv),
        salt: bytesToBase64(salt)
    };
}

async function decryptPassword(cipherTextBase64, ivBase64, saltBase64) {
    const dec = new TextDecoder();
    const salt = base64ToBytes(saltBase64);
    const iv = base64ToBytes(ivBase64);
    const key = await deriveKey(salt);
    const cipherBytes = base64ToBytes(cipherTextBase64);

    const plainBuffer = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: iv },
        key,
        cipherBytes
    );

    return dec.decode(plainBuffer);
}

// ====== Clave maestra ======
async function hashMasterPassword(password, uid) {
    const enc = new TextEncoder();
    const data = enc.encode(password + '::' + uid);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    return bytesToBase64(new Uint8Array(hashBuffer));
}

function initializeMasterPassword(user) {
    if (masterChecked) return;
    masterChecked = true;

    db.collection("dataUser")
        .where("iduser", "==", user.uid)
        .limit(1)
        .get()
        .then(snapshot => {
            if (snapshot.empty) {
                console.warn('No se encontró dataUser para el usuario');
                return;
            }
            const doc = snapshot.docs[0];
            currentUserDocId = doc.id;
            const data = doc.data();
            hasMasterPassword = !!data.masterPasswordHash;
        })
        .catch(err => {
            console.error('Error al obtener dataUser:', err);
        });
}

function showMasterPasswordModal() {
    const modalEl = document.getElementById('masterPasswordModal');
    if (!modalEl) {
        alert('No se encontró el modal de clave maestra en el HTML');
        return;
    }

    const title = document.getElementById('masterModalTitle');
    const desc = document.getElementById('masterModalDescription');
    const confirmGroup = document.getElementById('masterConfirmGroup');
    const input = document.getElementById('masterPasswordInput');
    const confirmInput = document.getElementById('masterPasswordConfirmInput');

    if (input) input.value = '';
    if (confirmInput) confirmInput.value = '';

    if (hasMasterPassword) {
        if (title) title.textContent = 'Introduce tu clave maestra';
        if (desc) desc.textContent = 'Esta clave se usará para mostrar tus contraseñas guardadas.';
        if (confirmGroup) confirmGroup.style.display = 'none';
    } else {
        if (title) title.textContent = 'Crea tu clave maestra';
        if (desc) desc.textContent = 'Esta clave protegerá la visualización de tus contraseñas. No la compartas con nadie.';
        if (confirmGroup) confirmGroup.style.display = 'block';
    }

    try {
        // Reusar instancia si ya existe, o crear una nueva
        let modal = bootstrap.Modal.getInstance(modalEl);
        if (!modal) {
            modal = new bootstrap.Modal(modalEl, { backdrop: 'static', keyboard: false });
        }
        modal.show();
    } catch (e) {
        console.error('Error al abrir modal de clave maestra:', e);
        alert('No se pudo abrir el modal de clave maestra. Revisa la consola del navegador.');
    }
}


async function submitMasterPassword() {
    const user = auth.currentUser;
    if (!user) {
        alert('Debe iniciar sesión primero');
        return;
    }

    const input = document.getElementById('masterPasswordInput');
    const confirmInput = document.getElementById('masterPasswordConfirmInput');
    const password = input ? input.value : '';
    const confirm = confirmInput ? confirmInput.value : '';

    if (!password) {
        alert('Ingresa tu clave maestra');
        return;
    }

    if (!hasMasterPassword) {
        if (password.length < 8) {
            alert('La clave maestra debe tener al menos 8 caracteres');
            return;
        }
        if (password !== confirm) {
            alert('Las claves no coinciden');
            return;
        }

        if (!currentUserDocId) {
            alert('No se encontró el documento de usuario');
            return;
        }

        try {
            const hash = await hashMasterPassword(password, user.uid);
            await db.collection("dataUser").doc(currentUserDocId).update({
                masterPasswordHash: hash
            });
            hasMasterPassword = true;
            sessionMasterUnlocked = true;
            const modalEl = document.getElementById('masterPasswordModal');
            const modal = bootstrap.Modal.getInstance(modalEl);
            if (modal) modal.hide();
        } catch (e) {
            console.error(e);
            alert('Error al guardar la clave maestra');
        }
    } else {
        try {
            const hash = await hashMasterPassword(password, user.uid);
            if (!currentUserDocId) {
                alert('No se encontró el documento de usuario');
                return;
            }
            const doc = await db.collection("dataUser").doc(currentUserDocId).get();
            const data = doc.data() || {};
            if (!data.masterPasswordHash) {
                alert('No hay clave maestra definida');
                return;
            }
            if (hash !== data.masterPasswordHash) {
                alert('Clave maestra incorrecta');
                return;
            }
            sessionMasterUnlocked = true;
            const modalEl = document.getElementById('masterPasswordModal');
            const modal = bootstrap.Modal.getInstance(modalEl);
            if (modal) modal.hide();
        } catch (e) {
            console.error(e);
            alert('Error al verificar la clave maestra');
        }
    }
}

function ensureMasterUnlocked() {
    if (sessionMasterUnlocked) return true;
    showMasterPasswordModal();
    return false;
}

// #region Cargar aplicación
window.onload = function () {
    loadPasswords();
    updateCategoryFilter();
};
// #endregion

// #region CRUD
function loadPasswords() {
    auth.onAuthStateChanged(function (user) {
        if (!user) {
            alert("Debe iniciar sesión primero");
            return;
        }

        initializeMasterPassword(user);
        passwords = [];

        // Cargar contraseñas propias
        const ownPasswordsPromise = db.collection("dataPassword")
            .where("uid", "==", user.uid)
            .get()
            .then(async (query) => {
                const results = await Promise.all(query.docs.map(async (doc) => {
                    const data = doc.data();
                    let plainPassword = data.password || ''; // compatibilidad con datos viejos

                    if (data.passwordEncrypted && data.iv && data.salt) {
                        try {
                            plainPassword = await decryptPassword(
                                data.passwordEncrypted,
                                data.iv,
                                data.salt
                            );
                        } catch (e) {
                            console.error("Error al descifrar:", e);
                            plainPassword = '[Error al descifrar]';
                        }
                    }

                    return {
                        ...data,
                        id: doc.id,
                        password: plainPassword,
                        isOwner: true,
                        isShared: false
                    };
                }));

                passwords.push(...results);
            });

        // Cargar contraseñas compartidas
        const sharedPasswordsPromise = db.collection("sharedPasswords")
            .where("sharedWithUid", "==", user.uid)
            .get()
            .then(async (sharedQuery) => {
                const sharedPromises = sharedQuery.docs.map(async (sharedDoc) => {
                    const sharedData = sharedDoc.data();

                    const passwordDoc = await db.collection("dataPassword")
                        .doc(sharedData.passwordId)
                        .get();

                    if (!passwordDoc.exists) return;

                    const data = passwordDoc.data();
                    let plainPassword = data.password || '';

                    if (data.passwordEncrypted && data.iv && data.salt) {
                        try {
                            plainPassword = await decryptPassword(
                                data.passwordEncrypted,
                                data.iv,
                                data.salt
                            );
                        } catch (e) {
                            console.error("Error al descifrar compartida:", e);
                            plainPassword = '[Error al descifrar]';
                        }
                    }

                    passwords.push({
                        ...data,
                        id: passwordDoc.id,
                        password: plainPassword,
                        isOwner: false,
                        isShared: true,
                        sharedBy: sharedData.ownerEmail || "Usuario",
                        sharedDocId: sharedDoc.id
                    });
                });

                return Promise.all(sharedPromises);
            });

        Promise.all([ownPasswordsPromise, sharedPasswordsPromise])
            .then(() => {
                renderPasswords();
                updateCategoryFilter();
            })
            .catch(error => {
                console.error("Error al cargar contraseñas:", error);
                alert("Error al cargar contraseñas: " + error.message);
            });
    });
}

async function savePassword() {
    const user = auth.currentUser;
    if (!user) {
        alert("Debe iniciar sesión primero");
        console.dir(auth);
        return;
    }

    const id = document.getElementById('passwordId').value;
    const website = document.getElementById('website').value;
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    const category = document.getElementById('category').value;
    const expiryDateInput = document.getElementById('expiryDate').value;
    const notes = document.getElementById('notes').value;

    const expiryDate = expiryDateInput ? firebase.firestore.Timestamp.fromDate(new Date(expiryDateInput)) : null;

    if (!website || !password || !category) {
        alert('Por favor completa todos los campos obligatorios');
        return;
    }

    let encrypted;
    try {
        encrypted = await encryptPassword(password);
    } catch (e) {
        console.error(e);
        alert('Error al cifrar la contraseña. No se guardó.');
        return;
    }

    const baseData = {
        website: website,
        username: username,
        passwordEncrypted: encrypted.cipherText,
        iv: encrypted.iv,
        salt: encrypted.salt,
        category: category,
        expiryDate: expiryDate,
        notes: notes
    };

    if (id) {
        db.collection("dataPassword").doc(id).update(baseData)
            .then(() => {
                alert("Contraseña actualizada correctamente");
                passwords = [];
                loadPasswords();
                updateCategoryFilter();
            })
            .catch(error => {
                alert("Error al actualizar: " + error);
            });
    } else {
        db.collection("dataPassword").add({
            ...baseData,
            uid: user.uid
        }).then(function (docRef) {
            alert("Contraseña guardada");
            passwords = [];
            loadPasswords();
            updateCategoryFilter();
        }).catch(function (FirebaseError) {
            alert("Error al guardar la contraseña: " + FirebaseError);
        });
    }

    const modalEl = document.getElementById('addPasswordModal');
    const modal = bootstrap.Modal.getInstance(modalEl);
    if (modal) modal.hide();
    document.getElementById('passwordForm').reset();
    editingId = null;
}

function editPassword(id) {
    const password = passwords.find(p => p.id === id);

    if (!password.isOwner) {
        alert("No puedes editar una contraseña compartida contigo");
        return;
    }

    document.getElementById('passwordId').value = password.id;
    document.getElementById('website').value = password.website;
    document.getElementById('username').value = password.username || '';
    document.getElementById('password').value = password.password;
    document.getElementById('category').value = password.category;
    document.getElementById('expiryDate').value = formatDate(password.expiryDate) || '';
    document.getElementById('notes').value = password.notes || '';
    document.getElementById('modalTitle').textContent = 'Editar Contraseña';

    updatePasswordStrength();

    new bootstrap.Modal(document.getElementById('addPasswordModal')).show();
}

function deletePassword(docId) {
    const password = passwords.find(p => p.id === docId);

    if (!password.isOwner) {
        alert("No puedes eliminar una contraseña compartida contigo");
        return;
    }

    if (confirm('¿Estás seguro de eliminar esta contraseña?')) {
        db.collection("dataPassword")
            .doc(docId)
            .delete()
            .then(() => {
                alert("Contraseña eliminada correctamente");
                passwords = [];
                loadPasswords();
                updateCategoryFilter();
            })
            .catch(error => {
                alert("Error al eliminar: " + error);
            });
    }
}
// #endregion

// #region Share Password
function sharePassword(id) {
    const password = passwords.find(p => p.id === id);

    if (!password.isOwner) {
        alert("No puedes compartir una contraseña que ya fue compartida contigo");
        return;
    }

    document.getElementById('shareWebsite').textContent = password.website;
    editingId = id;
    new bootstrap.Modal(document.getElementById('shareModal')).show();
}

function confirmShare() {
    const email = document.getElementById('shareEmail').value;
    if (!email) {
        alert('Ingresa un email válido');
        return;
    }

    const user = auth.currentUser;
    if (!user) {
        alert("Debe iniciar sesión primero");
        return;
    }

    db.collection("dataUser")
        .where("email", "==", email)
        .get()
        .then(querySnapshot => {
            if (querySnapshot.empty) {
                alert("No se encontró un usuario con ese email");
                return;
            }

            const targetUser = querySnapshot.docs[0].data();

            if (targetUser.iduser === user.uid) {
                alert("No puedes compartir una contraseña contigo mismo");
                return;
            }

            db.collection("sharedPasswords")
                .where("passwordId", "==", editingId)
                .where("sharedWithUid", "==", targetUser.iduser)
                .get()
                .then(existingShares => {
                    if (!existingShares.empty) {
                        alert("Esta contraseña ya está compartida con este usuario");
                        return;
                    }

                    db.collection("sharedPasswords").add({
                        passwordId: editingId,
                        ownerId: user.uid,
                        ownerEmail: user.email,
                        sharedWithUid: targetUser.iduser,
                        sharedWithEmail: email,
                        sharedAt: firebase.firestore.Timestamp.now()
                    })
                        .then(() => {
                            alert(`Contraseña compartida exitosamente con ${email}`);
                            const modalEl = document.getElementById('shareModal');
                            const modal = bootstrap.Modal.getInstance(modalEl);
                            if (modal) modal.hide();
                            document.getElementById('shareEmail').value = '';
                            editingId = null;
                        })
                        .catch(error => {
                            alert("Error al compartir: " + error.message);
                        });
                });
        })
        .catch(error => {
            alert("Error al buscar usuario: " + error.message);
        });
}
// #endregion

// #region UX / UI
function renderPasswords() {
    const container = document.getElementById('passwordsList');
    const searchTerm = document.getElementById('searchInput').value.toLowerCase();
    const categoryFilter = document.getElementById('categoryFilter').value;
    const statusFilter = document.getElementById('statusFilter').value;

    let filtered = passwords.filter(p => {
        const matchesSearch = p.website.toLowerCase().includes(searchTerm) ||
            p.category.toLowerCase().includes(searchTerm) || (p.notes && p.notes.toLowerCase().includes(searchTerm));
        const matchesCategory = !categoryFilter || p.category === categoryFilter;
        const matchesStatus = !statusFilter || getPasswordStatus(p.expiryDate) === statusFilter;
        return matchesSearch && matchesCategory && matchesStatus;
    });

    if (filtered.length === 0) {
        container.innerHTML = '';
        document.getElementById('emptyState').style.display = 'block';
        return;
    }

    document.getElementById('emptyState').style.display = 'none';
    container.innerHTML = filtered.map(p => {
        const status = getPasswordStatus(p.expiryDate);
        const statusClass = status === 'expired' ? 'expired' : status === 'expiring' ? 'expiring-soon' : 'safe';
        const categoryColor = getCategoryColor(p.category);

        const sharedBadge = p.isShared ?
            `<span class="badge bg-info ms-2"><i class="fas fa-share"></i> Compartida por ${p.sharedBy}</span>` : '';

        return `
            <div class="password-card ${statusClass}">
                <div class="row align-items-center">
                    <div class="col-md-4">
                        <h5 class="mb-1"><i class="fas fa-globe"></i> ${p.website}${sharedBadge}</h5>
                        ${p.username ? `<small class="text-muted">Usuario: ${p.username}</small><br>` : ''}
                        <span class="category-badge" style="background: ${categoryColor}20; color: ${categoryColor}">
                            ${p.category}
                        </span>
                    </div>
                    <div class="col-md-4">
                        <span class="password-display" id="pwd-${p.id}">••••••••</span>
                        <button class="btn btn-sm btn-outline-secondary" onclick="togglePassword('${p.id}')">
                            <i class="fas fa-eye"></i>
                        </button>
                        <button class="btn btn-sm btn-outline-primary" onclick="copyPassword('${p.id}')">
                            <i class="fas fa-copy"></i>
                        </button>
                        ${p.expiryDate ? `<br><small class="text-muted">Vence: ${formatDate(p.expiryDate)}</small>` : ''}
                    </div>
                    <div class="col-md-4 text-end">
                        ${p.isOwner ? `
                            <button class="btn btn-sm btn-success btn-action" onclick="editPassword('${p.id}')">
                                <i class="fas fa-edit"></i> Editar
                            </button>
                            <button class="btn btn-sm btn-info btn-action" onclick="sharePassword('${p.id}')">
                                <i class="fas fa-share"></i> Compartir
                            </button>
                            <button class="btn btn-sm btn-danger btn-action" onclick="deletePassword('${p.id}')">
                                <i class="fas fa-trash"></i> Eliminar
                            </button>
                        ` : `
                            <button class="btn btn-sm btn-secondary btn-action" disabled>
                                <i class="fas fa-lock"></i> Solo lectura
                            </button>
                        `}
                    </div>
                </div>
                ${p.notes ? `<div class="mt-2"><small><strong>Notas:</strong> ${p.notes}</small></div>` : ''}
            </div>
        `;
    }).join('');
}

function updateCategoryFilter() {
    const categories = [...new Set(passwords.map(p => p.category))];
    const select = document.getElementById('categoryFilter');
    const datalist = document.getElementById('categoryList');

    if (!select || !datalist) return;

    select.innerHTML = '<option value="">Todas las categorías</option>' +
        categories.map(c => `<option value="${c}">${c}</option>`).join('');

    datalist.innerHTML = categories.map(c => `<option value="${c}">`).join('');
}

function getPasswordStatus(expiryDate) {
    if (!expiryDate) return 'safe';
    const today = new Date();
    const expiry = expiryDate.toDate();
    const daysUntilExpiry = Math.floor((expiry - today) / (1000 * 60 * 60 * 24));

    if (daysUntilExpiry < 0) return 'expired';
    if (daysUntilExpiry <= 30) return 'expiring';
    return 'safe';
}

function getCategoryColor(category) {
    const colors = {
        'Redes Sociales': '#3b5998',
        'Banco': '#28a745',
        'Email': '#dc3545',
        'Trabajo': '#6f42c1',
        'Compras': '#fd7e14'
    };
    return colors[category] || '#667eea';
}
// #endregion

// #region Utilities

function formatDate(expiryDate) {
    if (!expiryDate) return '';
    return expiryDate.toDate().toISOString().substring(0, 10);
}

function togglePassword(id) {
    if (!ensureMasterUnlocked()) return;

    const item = passwords.find(p => p.id === id);
    if (!item) return;

    const password = item.password || '';
    const element = document.getElementById(`pwd-${id}`);
    if (!element) return;

    if (element.textContent === '••••••••') {
        element.textContent = password;
        setTimeout(() => {
            if (element.textContent === password) {
                element.textContent = '••••••••';
            }
        }, 5000);
    } else {
        element.textContent = '••••••••';
    }
}

function togglePasswordVisibility() {
    const input = document.getElementById('password');
    const icon = document.getElementById('toggleIcon');
    if (!input || !icon) return;

    if (input.type === 'password') {
        input.type = 'text';
        icon.className = 'fas fa-eye-slash';
    } else {
        input.type = 'password';
        icon.className = 'fas fa-eye';
    }
}

function copyPassword(id) {
    if (!ensureMasterUnlocked()) return;

    const item = passwords.find(p => p.id === id);
    if (!item) return;

    const password = item.password || '';
    navigator.clipboard.writeText(password)
        .then(() => alert('Contraseña copiada al portapapeles'))
        .catch(() => alert('No se pudo copiar la contraseña'));
}

// Fuerza de contraseña
function calculatePasswordScore(pwd) {
    let score = 0;
    if (!pwd) return 0;

    if (pwd.length >= 8) score++;
    if (pwd.length >= 12) score++;
    if (/[a-z]/.test(pwd) && /[A-Z]/.test(pwd)) score++;
    if (/\d/.test(pwd)) score++;
    if (/[^A-Za-z0-9]/.test(pwd)) score++;

    return Math.min(score, 4);
}

function updatePasswordStrength() {
    const pwdInput = document.getElementById('password');
    const container = document.getElementById('passwordStrength');
    const bar = document.getElementById('passwordStrengthBar');
    const text = document.getElementById('passwordStrengthText');

    if (!pwdInput || !container || !bar || !text) return;

    const pwd = pwdInput.value;

    if (!pwd) {
        container.style.display = 'none';
        return;
    }

    container.style.display = 'block';
    const score = calculatePasswordScore(pwd);

    let width = (score / 4) * 100;
    let label = '';
    let barClass = 'bg-danger';

    switch (score) {
        case 1:
            label = 'Muy débil';
            barClass = 'bg-danger';
            break;
        case 2:
            label = 'Débil';
            barClass = 'bg-warning';
            break;
        case 3:
            label = 'Buena';
            barClass = 'bg-info';
            break;
        case 4:
            label = 'Fuerte';
            barClass = 'bg-success';
            break;
        default:
            width = 10;
            label = 'Muy débil';
    }

    bar.style.width = width + '%';
    bar.className = 'progress-bar ' + barClass;
    text.textContent = 'Fuerza: ' + label;
}

function generatePassword() {
    const pwdInput = document.getElementById('password');
    if (!pwdInput) return;

    const length = 16;
    const upper = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const lower = 'abcdefghijklmnopqrstuvwxyz';
    const digits = '0123456789';
    const symbols = '!@#$%^&*()-_=+[]{};:,.<>?';

    const all = upper + lower + digits + symbols;

    let passwordChars = [
        upper[Math.floor(Math.random() * upper.length)],
        lower[Math.floor(Math.random() * lower.length)],
        digits[Math.floor(Math.random() * digits.length)],
        symbols[Math.floor(Math.random() * symbols.length)]
    ];

    const remainingLength = length - passwordChars.length;
    const randomBytes = new Uint8Array(remainingLength);
    crypto.getRandomValues(randomBytes);

    for (let i = 0; i < remainingLength; i++) {
        const index = randomBytes[i] % all.length;
        passwordChars.push(all[index]);
    }

    for (let i = passwordChars.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [passwordChars[i], passwordChars[j]] = [passwordChars[j], passwordChars[i]];
    }

    const password = passwordChars.join('');
    pwdInput.value = password;
    updatePasswordStrength();
}

function exit() {
    auth.signOut().then(() => {
        document.location.href = 'index.html';
    }).catch((error) => {
        alert('Error al cerrar la sesión: ' + error.message);
    });
}
// #endregion

// #region Event listeners
document.getElementById('searchInput').addEventListener('input', renderPasswords);
document.getElementById('categoryFilter').addEventListener('change', renderPasswords);
document.getElementById('statusFilter').addEventListener('change', renderPasswords);

document.getElementById('addPasswordModal').addEventListener('hidden.bs.modal', function () {
    document.getElementById('passwordForm').reset();
    document.getElementById('passwordId').value = '';
    document.getElementById('modalTitle').textContent = 'Agregar Contraseña';

    const strength = document.getElementById('passwordStrength');
    if (strength) strength.style.display = 'none';
});

const pwdInput = document.getElementById('password');
if (pwdInput) {
    pwdInput.addEventListener('input', updatePasswordStrength);
}
// #endregion