# We created few intents to test ...

## 🎯 5 Healthcare Intents

Intent 1: Medication Dosage Questions - "How much/when to take pills, dosage timing, prescription instructions"

Intent 2: Medication Side Effects - "Drug reactions, pills making me sick, adverse effects, allergies"

Intent 3: Lab Results Interpretation - "Blood test results, diagnostic reports, abnormal values" (📸 Media Support)

Intent 4: Home Medical Equipment - "CPAP not working, oxygen concentrator problems, device troubleshooting"

Intent 5: Surgery Preparation/Recovery - "Pre-op instructions, post-surgical care, wound care, recovery questions"

> First 2 are ambiguous intents


# We created and attached few tools to the intents

Tool 1: EHR Patient Lookup - "Instantly retrieves patient medical records, medications, allergies, and insurance information"

Tool 2: Provider Schedule Manager - "Displays real-time physician availability, appointment slots, and on-call schedules"

Tool 3: Insurance Verification System - "Automatically verifies patient insurance coverage, pre-authorization status, copays, and benefits"

Tool 4: Biomedical Equipment Tracker - "Monitors medical equipment status, maintenance schedules, warranties, and failure alerts"

Tool 5: Hospital System Status Monitor - "Tracks critical hospital infrastructure including HVAC, power, IT networks, and safety systems"

Tool 6: Pharmacy Integration Tool - "Checks medication availability, drug interactions, allergies, and manages prescription orders"

Tool 7: Clinical Team Messenger - "Provides HIPAA-compliant secure messaging between doctors, nurses, and healthcare staff"

Tool 8: Patient Notification System - "Sends automated appointment reminders, test results, and care instructions via email/SMS"

Tool 9: Bed Management System - "Tracks hospital bed availability, manages patient placement, transfers, and discharge coordination"

Tool 10: Clinical Incident Reporter - "Documents patient safety incidents, medical errors, and equipment failures with regulatory reporting"

[View the intents and tools in the Admin UI](https://d2v1pfi3qzvh02.cloudfront.net)

# Testcases

## 🎯 **Test Case 1: Portal Access Issue**

### **Initial User Query:**

> "Hi, I've been trying to log into MyChart for the past 3 days to check my blood test results from last week, but it keeps saying my password is incorrect. I tried resetting it twice but never received the email. Can you help me access my patient portal?"

### **When AI Asks for Verification, Provide:**

```
Full Name: John Doe
Date of Birth: March 15, 1978
Phone Number: (555) 123-4567

```

### **Additional Context (if needed):**

```
Patient ID: PAT-2024-001234
Current Email: john.doe.old@email.com (outdated)
New Email: john.doe@gmail.com
Insurance: Blue Cross Blue Shield
Last Visit: June 18, 2025 (blood work)

```

----------

## 🎯 **Test Case 2: Insurance Problem**

### **Initial User Query:**

> "I just received a bill for $2,500 for my MRI scan last month, but my insurance was supposed to cover it with just a $50 copay. The billing department said my pre-authorization was denied, but my doctor's office told me it was approved. This is really confusing and stressful."

### **When AI Asks for Details, Provide:**

```
Full Name: Sarah Johnson
Date of Birth: August 22, 1985
Patient ID: PAT-2024-005678
Insurance Provider: Blue Cross Blue Shield
Policy Number: BC123456789
Group Number: GRP001
MRI Date: May 25, 2025
Procedure: Brain MRI
Referring Doctor: Dr. Williams (Neurology)

```

### **Additional Context:**

```
Phone: (555) 234-5678
Expected Copay: $50
Bill Received: $2,500
Pre-auth Number: PA2025-001234 (expired)

```

----------

## 🎯 **Test Case 3: Equipment Emergency**

### **Initial User Query:**

> "I'm a nurse in ICU Room 204 and the ventilator for my patient is showing error codes and making unusual beeping sounds. The backup alarm just went off and I need immediate assistance. This is urgent as it's affecting patient care."

### **When AI Asks for Details, Provide:**

```
Staff Name: Lisa Chen, RN
Employee ID: NURSE-001
Department: ICU
Room Number: 204
Equipment: Ventilator
Patient: Room 204 Bed A
Error Codes: E-302, VENT-FAIL
Contact: Extension 2847

```

### **Additional Context:**

```
Equipment ID: EQ-VEN-204-01
Equipment Model: Philips V60
Patient Condition: Stable on backup ventilation
Backup Equipment: Available in Room 205
Time of Incident: 10:30 AM

```

----------

## 🎯 **Test Case 4: Urgent Appointment**

### **Initial User Query:**

> "My cardiologist cancelled my appointment scheduled for tomorrow due to an emergency, but I really need to see a heart specialist this week because my chest pain is getting worse. Can you help me find another cardiologist who has availability soon?"

### **When AI Asks for Details, Provide:**

```
Full Name: Robert Chen
Date of Birth: November 10, 1965
Patient ID: PAT-2024-009876
Phone: (555) 987-6543
Original Doctor: Dr. Adams (Cardiology)
Cancelled Appointment: June 24, 2025 at 3:00 PM
Insurance: Aetna
Policy Number: AET987654321

```

### **Additional Context:**

```
Symptoms: Worsening chest pain (3 days)
Previous Cardiac History: 2023 stent placement
Current Medications: Lisinopril, Metoprolol, Aspirin
Urgency Level: Within 24-48 hours
Preferred Time: Afternoon appointments

```

----------

## 🎯 **Test Case 5: Communication Breakdown**

### **Initial User Query:**

> "It's been 5 days since my biopsy and nobody has called me with the results. I've left 3 messages for Dr. Smith's office and called the main hospital number twice. My family is really worried and we just want to know what's going on with my test results."

### **When AI Asks for Details, Provide:**

```
Full Name: Maria Rodriguez
Date of Birth: February 28, 1972
Patient ID: PAT-2024-007531
Phone: (555) 345-6789
Doctor: Dr. Michael Smith (Pathology)
Procedure: Breast Biopsy
Biopsy Date: June 18, 2025
Procedure Location: Outpatient Surgery Center

```

### **Additional Context:**

```
Insurance: Medicare + Supplement
Emergency Contact: Carlos Rodriguez (husband) - (555) 345-6790
Referring Doctor: Dr. Lisa Park (Oncology)
Anxiety Level: High (family very concerned)
Previous Messages: 3 calls to Dr. Smith's office

```

----------

## 🎯 **Ambiguous Test Case 1: Medication Issue**

### **Initial User Query:**

> "I'm having trouble with my blood pressure medication. It's not working like it used to and I'm getting headaches. Should I be taking it differently?"

### **When AI Asks for Clarification, User Should Choose:**

**Option A:** "I think it's about dosage - maybe I need to take it at a different time or amount"

### **Then When AI Asks for Details, Provide:**

```
Full Name: James Wilson
Date of Birth: April 12, 1958
Patient ID: PAT-2024-008765
Phone: (555) 456-7890
Current Medication: Lisinopril 10mg
Prescribed by: Dr. Thompson (Primary Care)
Taking Since: January 2025
Current Schedule: Once daily in morning
Recent Changes: None

```

### **Additional Context:**

```
Blood Pressure Readings: 150/95 (last 3 days)
Target BP: Under 130/80
Headache Pattern: Afternoon/evening
Other Medications: Metformin, Vitamin D
Last Doctor Visit: March 2025

```

----------

## 🎯 **Ambiguous Test Case 2: Glucose Monitor**

### **Initial User Query:**

> "My home glucose monitor is showing readings that don't make sense. The numbers are way higher than normal and I'm not sure if I should trust them."

### **When AI Asks for Clarification, User Should Choose:**

**Option B:** "I'm concerned about what these high glucose readings mean for my health"

### **Then When AI Asks for Details, Provide:**

```
Full Name: Susan Davis
Date of Birth: September 5, 1969
Patient ID: PAT-2024-006543
Phone: (555) 654-3210
Monitor Model: OneTouch Verio
Recent Readings: 280, 295, 310 mg/dL
Normal Range: Usually 120-140 mg/dL
Testing Time: Morning fasting

```

### **Additional Context:**

```
Diabetes Type: Type 2 (diagnosed 2020)
Current Medications: Metformin 1000mg twice daily
Last A1C: 7.2% (3 months ago)
Recent Changes: Started new heart medication (Metoprolol)
Symptoms: Increased thirst, frequent urination
Primary Care Doctor: Dr. Martinez

```

----------

## 📸 **Media Support Test Case: Lab Results**

### **Initial User Query:**

> "I got my blood test results back but I don't understand what they mean. Some of the numbers are highlighted in red. Can you help me figure out if I should be worried?"

### **Media Upload Required:**

Upload lab report image showing abnormal values

### **When AI Asks for Details, Provide:**

```
Full Name: Michael Thompson
Date of Birth: January 15, 1975
Patient ID: PAT-2024-003456
Phone: (555) 321-4567
Test Date: June 20, 2025
Ordering Doctor: Dr. Martinez (Primary Care)
Reason for Test: Annual physical + follow-up

```

### **Additional Context:**

```
Insurance: UnitedHealthcare
Policy Number: UHC456789123
Medical History: Hypertension, Pre-diabetes
Current Medications: Lisinopril 5mg daily
Last Physical: June 2024
Family History: Diabetes (father), Kidney disease (mother)
Symptoms: Fatigue, increased urination

```

[Try it out here](https://d2v1pfi3qzvh02.cloudfront.net/support/cases)




