// src/app/dashboard/courses/page.tsx
import { Play, Clock, Award, Users } from "lucide-react";

export default function CoursesPage() {
  const courses = [
    {
      title: "English Pronunciation",
      instructor: "John Doe",
      lessons: 24,
      duration: "12 hours",
      students: 1500,
      progress: 65,
      level: "Beginner",
    },
    {
      title: "Business English",
      instructor: "Jane Smith",
      lessons: 18,
      duration: "9 hours",
      students: 800,
      progress: 30,
      level: "Intermediate",
    },
    {
      title: "IELTS Preparation",
      instructor: "Michael Johnson",
      lessons: 32,
      duration: "16 hours",
      students: 2200,
      progress: 0,
      level: "Advanced",
    },
    {
      title: "Conversation Practice",
      instructor: "Sarah Williams",
      lessons: 15,
      duration: "7.5 hours",
      students: 1200,
      progress: 90,
      level: "All Levels",
    },
  ];

  return (
    <div>
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-foreground">Courses</h1>
        <button className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors">
          Browse All
        </button>
      </div>

      {/* My Courses */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {courses.map((course, index) => (
          <div
            key={index}
            className="group cursor-pointer rounded-xl border border-border bg-card p-4 shadow-sm transition-all hover:shadow-md"
          >
            <div className="mb-3 aspect-video w-full rounded-lg bg-muted flex items-center justify-center">
              <Play size={24} className="text-muted-foreground" />
            </div>
            <h3 className="mb-1 font-medium text-foreground truncate">{course.title}</h3>
            <p className="mb-2 text-xs text-muted-foreground">{course.instructor}</p>

            {/* Meta Info */}
            <div className="mb-3 flex items-center gap-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <Clock size={12} />
                {course.duration}
              </span>
              <span className="flex items-center gap-1">
                <Users size={12} />
                {course.students.toLocaleString()}
              </span>
            </div>

            {/* Level Badge */}
            <div className="mb-3">
              <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                course.level === "Beginner" ? "bg-green-100 text-green-800" :
                course.level === "Intermediate" ? "bg-yellow-100 text-yellow-800" :
                course.level === "Advanced" ? "bg-red-100 text-red-800" :
                "bg-blue-100 text-blue-800"
              }`}>
                {course.level}
              </span>
            </div>

            {/* Progress Bar */}
            {course.progress > 0 && (
              <div className="mb-3">
                <div className="mb-1 flex justify-between text-xs text-muted-foreground">
                  <span>Progress</span>
                  <span>{course.progress}%</span>
                </div>
                <div className="h-2 w-full rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary transition-all"
                    style={{ width: `${course.progress}%` }}
                  />
                </div>
              </div>
            )}

            {/* Action Button */}
            <button className="w-full rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors">
              {course.progress > 0 ? "Continue" : "Start Course"}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
