==================================================================================================================================================
Study Center....: Universidad Técnica Nacional  
Campus..........: Pacífico (JRMP)  
College career..: Ingeniería en Tecnologías de Información  
Period..........: 3C-2025  
Course..........: ITI-712 – Tecnologías y Sistemas Web III  
Document........: Final Project – Password Manager (Web App)

Professor.......: Jorge Ruiz (york)  
Students........: Michael Carranza Porras, Frank Mora, Kevin Picado, Kevin Alfonso Núñez Parra  
Title...........: Password Manager with Firebase  
Description.....: Secure web-based password manager using Firebase Authentication and Cloud Firestore.
                  Users can register, log in, store, share and manage encrypted credentials, and receive
                  local browser notifications when passwords are close to expiration.
==================================================================================================================================================

## 1. Problem description

Users today manage many different credentials (university platforms, social networks, banking, etc.).
Reusing the same password is insecure, but remembering strong and unique passwords for every service
is not realistic.  

This project implements a **web password manager** that stores credentials securely in the cloud,
applies encryption in the browser and allows controlled sharing and basic reporting.

---

## 2. Objectives

1. **Build a complete web app using Firebase** (Authentication, Firestore and Hosting) to manage
   users and passwords in the cloud.
2. **Protect credentials with client-side encryption and a master password**, ensuring that only the
   authenticated and authorized user can view or copy stored passwords.
3. **Provide useful functionality for real use**, including CRUD of passwords, search and filters,
   sharing between users, report generation on screen and local notifications before expiration.

---

## 3. System overview (maintenances and main process)

### 3.1 Users maintenance

- Register users with email/password and Google sign-in (second auth method).  
- Authenticate users and validate the active user before accessing `passManager.html`.  
- Store profile data in `dataUser` (UID, name, email, optional photo URL and master password hash).  
- Handle logout and session validation for navigation between pages.

### 3.2 Passwords maintenance (CRUD, consultation, report)

- Complete CRUD on `dataPassword`: site, username, encrypted password, category, expiry date, notes.  
- AES-GCM encryption in the browser using a key derived from the master password before saving.  
- Search box + filters by category and status (safe, expiring, expired) to consult existing records.  
- “Generate Report” button to build a summary view (totals, own vs shared, status and categories)
  that can be exported as PDF using the browser’s print dialog.

### 3.3 Main process – share passwords and update “library”

- Owner selects a password and enters another user’s email to share it.  
- System validates the target user in `dataUser` and creates a record in `sharedPasswords`.  
- The shared password appears in the receiver’s list with a label showing who shared it.  
- When a password is deleted, related `sharedPasswords` entries are also removed, keeping the library
  consistent.  
- Periodic task checks for passwords that will expire within 7 days and sends **local browser
  notifications** (no remote push) when notifications are allowed.

---

## 4. About

- **Authors:** Michael Carranza Porras, Frank Mora, Kevin Picado, Kevin Alfonso Núñez Parra.  
- **Technologies:** HTML5, CSS3, Bootstrap 5, JavaScript (ES6+), Font Awesome, Firebase Authentication,
  Cloud Firestore, Firebase Hosting, Web Crypto API, Web Notifications API.  
- **Final product:** A functional password manager web app with authentication, encrypted storage,
  sharing between users, filters, a basic on-screen report and notification support for upcoming
  expirations.

---

## 5. UML sequence diagrams (Mermaid)

### 5.1 Users maintenance – registration and profile creation

```mermaid
sequenceDiagram
    participant U as User
    participant UI as Web App
    participant FA as Firebase Auth
    participant FS as Firestore

    U->>UI: Submit registration form
    UI->>FA: createUserWithEmailAndPassword()
    FA-->>UI: Return UID / auth result
    UI->>FS: Create dataUser document (UID, name, email)
    FS-->>UI: Confirm write
    UI-->>U: Show success and redirect to login


###5.2 Passwords maintenance – create / update credential

sequenceDiagram
    participant U as User
    participant UI as Web App
    participant ENC as Crypto (AES-GCM)
    participant FS as Firestore

    U->>UI: Submit password form (site, user, password, etc.)
    UI->>ENC: Encrypt password with master key
    ENC-->>UI: cipherText, iv, salt
    UI->>FS: Save or update dataPassword document
    FS-->>UI: Confirm write
    UI-->>U: Refresh password list with filters and search


###5.3 Main process – share password and update library

sequenceDiagram
    participant Owner as Owner
    participant UI as Web App
    participant FS as Firestore

    Owner->>UI: Click "Share" and enter target email
    UI->>FS: Find dataUser by email
    FS-->>UI: Return target UID or empty
    UI-->>Owner: Show error if user not found
    UI->>FS: Create sharedPasswords document (passwordId, ownerId, targetUid)
    FS-->>UI: Confirm write
    UI-->>Owner: Show "Password shared" message
    Note right of UI: When listing passwords, join<br/>dataPassword + sharedPasswords<br/>to show shared items

---

##6. Conclusions

1. Achievement of objectives

    The project meets the three proposed objectives: it uses Firebase as core platform, encrypts
    passwords in the browser with a master key and implements real features such as CRUD,
    sharing, reporting and notifications.

2. What was left to finish

    Improve the reporting section with more visual charts and direct PDF export.

    Add a dedicated profile screen to edit user data (name and photo) in a more friendly way.

3. Next steps to continue the project

    Implement advanced security features (password strength policies, login history, 2FA).

    Add roles/permissions for shared passwords (read-only, time-limited access).

    Create integration tests and deploy to a public Firebase Hosting URL.

4. Assessment of Firebase vs other technologies

    Compared to building a custom backend with Node.js + REST API + relational database, Firebase
    greatly simplifies authentication, hosting and real-time data access, reducing the amount of
    server code and deployment work.

    As drawbacks, it introduces vendor lock-in, quota/billing limits and less control over the
    underlying infrastructure, which can be a constraint for very large or highly customized
    solutions.