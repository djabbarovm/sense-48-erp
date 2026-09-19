-- AlterEnum (ADR-038: коммерческий директор и CEO как операционные профили)
-- Директор = права коммерческого менеджера (надзор, область видимости — в домене).
-- CEO = только видимость (все *.view + дашборды + аудит), без изменения/согласования.
ALTER TYPE "RoleCode" ADD VALUE 'COMMERCIAL_DIRECTOR';
ALTER TYPE "RoleCode" ADD VALUE 'CEO';
